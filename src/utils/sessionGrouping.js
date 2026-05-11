/**
 * 주문 배열을 "세션" 단위로 묶는다.
 *
 * 세션 경계 판별:
 *  - Table.currentSessionSeq는 주문 들어올 때마다 +1, "테이블 비우기" 시 0으로 리셋됨
 *  - 즉 같은 테이블에서 주문들을 시간순 정렬했을 때,
 *    sessionSeq가 이전보다 작거나 같으면 새 세션 시작
 *  - sessionSeq가 없거나 0인 과거 데이터는 각각 별도 세션으로 취급
 */

function aggregateItems(orders) {
  // 취소가 아닌 주문들의 아이템을 (name, variantName, price)별로 수량 합산
  const map = new Map();
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    for (const item of order.items || []) {
      const variantName = item.variantName || '';
      const key = `${item.name}__${variantName}__${item.price}`;
      if (!map.has(key)) {
        map.set(key, { name: item.name, variantName, price: item.price, quantity: 0 });
      }
      map.get(key).quantity += item.quantity || 0;
    }
  }
  return Array.from(map.values());
}

function finalizeSession(draft) {
  const orders = draft.orders;

  let totalPrice = 0;
  let cancelledTotal = 0;
  let cancelledCount = 0;
  let activeCount = 0;
  let servedCount = 0;
  const activeStatuses = new Set(['pending', 'accepted', 'preparing', 'ready']);

  for (const o of orders) {
    if (o.status === 'cancelled') {
      cancelledCount += 1;
      cancelledTotal += Number(o.totalPrice) || 0;
    } else {
      totalPrice += Number(o.totalPrice) || 0;
      if (o.status === 'served') servedCount += 1;
      else if (activeStatuses.has(o.status)) activeCount += 1;
    }
  }

  // 대표 상태: 활성 > 취소 있음 > 서빙 완료
  let status;
  if (activeCount > 0) status = 'active';
  else if (servedCount > 0 && cancelledCount === 0) status = 'served';
  else if (servedCount === 0 && cancelledCount > 0) status = 'cancelled';
  else status = 'mixed'; // 일부 서빙 + 일부 취소

  const startedAt = orders[0].createdAt;
  const endedAt = orders[orders.length - 1].createdAt;

  return {
    id: `${draft.tableId}:${new Date(startedAt).toISOString()}`,
    tableId: draft.tableId,
    tableNumber: draft.tableNumber,
    floor: draft.floor,
    startedAt,
    endedAt,
    orderCount: orders.length,
    servedCount,
    activeCount,
    cancelledCount,
    items: aggregateItems(orders),
    totalPrice,
    cancelledTotal,
    status,
    orderIds: orders.map((o) => String(o._id || o.id)),
    orders, // 상세 펼침용 원본 주문들
  };
}

/**
 * @param {Array} orders - Mongoose lean 결과 배열
 * @returns {Array} 세션 배열 (startedAt DESC 정렬)
 */
function groupOrdersIntoSessions(orders) {
  // 테이블별 묶고 시간순 정렬
  const byTable = new Map();
  for (const o of orders) {
    const key = String(o.tableId || '');
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key).push(o);
  }

  const sessions = [];
  for (const [tableKey, tableOrders] of byTable) {
    tableOrders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    let current = null;
    let prevSeq = null;

    for (const o of tableOrders) {
      const seq = Number(o.sessionSeq || 0);
      // 세션 경계: 첫 주문이거나, sessionSeq가 이전보다 작거나 같으면(리셋)
      // sessionSeq가 0이하인 경우도 각자 별도 세션
      const boundary =
        current === null ||
        seq <= 0 ||
        (prevSeq != null && seq <= prevSeq);

      if (boundary) {
        if (current) sessions.push(finalizeSession(current));
        current = {
          tableId: o.tableId,
          tableNumber: o.tableNumber,
          floor: o.floor,
          orders: [],
        };
      }
      current.orders.push(o);
      prevSeq = seq > 0 ? seq : null;
    }

    if (current) sessions.push(finalizeSession(current));
  }

  // 최신 세션이 위로
  sessions.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return sessions;
}

module.exports = { groupOrdersIntoSessions, finalizeSession, aggregateItems };
