# Server (table-home-server)

Express.js + MongoDB 백엔드 API 서버. REST API와 WebSocket을 제공한다.

## 실행

```bash
npm run dev    # nodemon 자동 리로드 (포트 5001)
npm start      # 프로덕션
npm run seed   # DB 초기 데이터 시딩
```

## 기술 스택

- Express.js 5 / Node.js / JavaScript (TS 없음)
- Mongoose 9 (MongoDB ODM)
- jsonwebtoken (JWT 인증, 7일 만료)
- bcryptjs (비밀번호 해싱, salt 10)
- multer (파일 업로드, 메모리 스토리지, 5MB 제한)
- @aws-sdk/client-s3 (이미지 S3 업로드)
- ws (WebSocket 서버, 30초 heartbeat)
- cors, dotenv

## 환경변수

```
PORT=5001
JWT_SECRET=table-home-secret-key
MONGODB_URI=mongodb+srv://...
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=mom-order-service-admin
```

## 디렉토리 구조

```
server/src/
├── index.js           # 서버 진입점 (Express + WS + MongoDB 연결)
├── websocket.js       # WebSocket 설정 + broadcast 함수
├── seed.js            # DB 시딩 (카테고리5, 상품10, 테이블8, 관리자1)
├── uploads/           # 로컬 파일 저장 디렉토리
├── middleware/
│   └── auth.js        # JWT 인증 + adminOnly 미들웨어
├── models/
│   ├── Admin.js       # email, password(bcrypt), name, role(owner/staff)
│   ├── Category.js    # name, slug(자동), order, isActive
│   ├── Product.js     # name, price, image(S3), categoryIds[], badges[], stock, isSoldOut, showOnKiosk, showOnTable
│   ├── Order.js       # tableId, items[], totalPrice, status(pending→accepted→preparing→ready→served/cancelled)
│   ├── Table.js       # number, floor, token(32자 hex 자동), isOccupied, lastClearedAt
│   ├── StaffCall.js   # tableId, tableNumber, floor, status(pending/resolved)
│   └── Notice.js      # content, isActive
└── routes/
    ├── auth.js        # POST /register, /login
    ├── products.js    # CRUD + reorder + sold-out + toggle-channel
    ├── categories.js  # CRUD + reorder
    ├── orders.js      # 생성(WS broadcast), 목록, 상태변경(WS broadcast)
    ├── tables.js      # CRUD + status + token 조회
    ├── staffCalls.js  # 생성(WS broadcast), 목록, resolve
    ├── notices.js     # CRUD
    └── upload.js      # S3 이미지 업로드
```

## API 엔드포인트

### 인증 (Public)
- `POST /api/auth/register` - 관리자 계정 생성
- `POST /api/auth/login` - 로그인 (JWT 반환)

### 상품 (GET: Public / 나머지: Auth)
- `GET /api/products` - 목록 (category, search, channel 필터)
- `GET /api/products/:id` - 상세
- `POST /api/products` - 등록
- `PUT /api/products/:id` - 수정
- `DELETE /api/products/:id` - 삭제 (soft delete)
- `PATCH /api/products/reorder` - 순서 변경 (ids 배열)
- `PATCH /api/products/:id/sold-out` - 품절 토글
- `PATCH /api/products/:id/toggle-channel` - 키오스크/테이블 노출 토글

### 카테고리 (GET: Public / 나머지: Auth)
- `GET /api/categories` - 목록
- `POST /api/categories` - 추가
- `PUT /api/categories/:id` - 수정
- `DELETE /api/categories/:id` - 삭제 (soft delete)
- `PATCH /api/categories/reorder` - 순서 변경

### 주문 (POST, GET table: Public / 나머지: Auth)
- `POST /api/orders` - 생성 (NEW_ORDER 브로드캐스트)
- `GET /api/orders` - 목록 (status, date, search, pagination)
- `GET /api/orders/table/:tableId` - 테이블 당일 주문
- `GET /api/orders/:id` - 상세
- `PATCH /api/orders/:id/status` - 상태 변경 (ORDER_STATUS 브로드캐스트)

### 테이블 (token: Public / 나머지: Auth)
- `GET /api/tables` - 목록
- `GET /api/tables/status` - 현황 (활성 주문 포함)
- `GET /api/tables/token/:token` - QR 토큰 조회
- `POST /api/tables` - 추가
- `PUT /api/tables/:id` - 수정 (lastClearedAt 설정 시 활성 주문 자동 served)
- `DELETE /api/tables/:id` - 삭제

### 직원호출 (POST: Public / 나머지: Auth)
- `POST /api/staff-calls` - 호출 (STAFF_CALL 브로드캐스트)
- `GET /api/staff-calls` - 대기 목록
- `PATCH /api/staff-calls/:id/resolve` - 처리 완료

### 공지사항 (GET: Public / 나머지: Auth)
- `GET /api/notices` - 목록
- `POST /api/notices` - 추가
- `PUT /api/notices/:id` - 수정
- `DELETE /api/notices/:id` - 삭제 (soft delete)

### 파일 업로드 (Auth)
- `POST /api/upload` - S3 업로드 (jpg/jpeg/png/gif/webp, 5MB)

### 헬스체크
- `GET /api/health` - {status: 'ok'}

## WebSocket 이벤트

| 이벤트 | 발생 시점 | 데이터 |
|--------|----------|--------|
| NEW_ORDER | 주문 생성 | 주문 객체 |
| ORDER_STATUS | 상태 변경 | 주문 객체 |
| STAFF_CALL | 직원 호출 | 호출 객체 |

## 주요 패턴

### 인증 흐름
- `Authorization: Bearer <token>` 헤더
- `auth` 미들웨어: JWT 검증 → req.admin에 사용자 정보 부착
- `adminOnly` 미들웨어: role === 'owner' 확인 (정의됨, 현재 미사용)

### 데이터 관리
- Soft delete: isActive 플래그로 논리 삭제
- Bulk reorder: bulkWrite로 순서 일괄 변경
- Lean queries: 읽기 전용 쿼리에 .lean() 사용
- Populate: 참조 데이터 자동 조인

### 에러 처리
- try-catch + console.log
- 응답 형식: `{ message: '...', error: error.message }`
- HTTP 상태: 200, 201, 400, 401, 403, 404, 500

### 시드 데이터
- 카테고리 5개: 추천메뉴, 라멘, 토핑, 사이드메뉴, 음료
- 상품 10개: 라멘류, 토핑, 사이드, 음료
- 테이블 8개: 1층 5개, 2층 3개
- 관리자: admin@table-home.com / password123
