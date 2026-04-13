require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('./models/Category');
const Product = require('./models/Product');
const Table = require('./models/Table');
const Admin = require('./models/Admin');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/table-home';

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('[Seed] MongoDB 연결 성공');

    // 기존 데이터 초기화
    await Promise.all([
      Category.deleteMany({}),
      Product.deleteMany({}),
      Table.deleteMany({}),
      Admin.deleteMany({}),
    ]);
    console.log('[Seed] 기존 데이터 삭제 완료');

    // 카테고리 생성
    const categories = await Category.insertMany([
      { name: '추천메뉴', slug: '추천메뉴', order: 0 },
      { name: '라멘', slug: '라멘', order: 1 },
      { name: '토핑', slug: '토핑', order: 2 },
      { name: '사이드메뉴', slug: '사이드메뉴', order: 3 },
      { name: '음료', slug: '음료', order: 4 },
    ]);
    console.log(`[Seed] 카테고리 ${categories.length}개 생성 완료`);

    // 카테고리 매핑
    const catMap = {};
    categories.forEach((c) => {
      catMap[c.name] = c._id;
    });

    // 상품 생성
    const products = await Product.insertMany([
      {
        name: '신라멘',
        price: 10000,
        categoryIds: [catMap['라멘']],
        badges: ['인기'],
        isSoldOut: true,
        description: '매콤한 일본식 라멘',
      },
      {
        name: '돈코츠라멘',
        price: 11000,
        categoryIds: [catMap['라멘']],
        badges: ['신규'],
        description: '진한 돼지뼈 육수의 라멘',
      },
      {
        name: '쇼유라멘',
        price: 10500,
        categoryIds: [catMap['라멘']],
        description: '간장 베이스 라멘',
      },
      {
        name: '미소라멘',
        price: 10500,
        categoryIds: [catMap['라멘']],
        badges: ['추천'],
        description: '된장 베이스 라멘',
      },
      {
        name: '차슈토핑',
        price: 2000,
        categoryIds: [catMap['토핑']],
        description: '부드러운 차슈 추가',
      },
      {
        name: '계란토핑',
        price: 1500,
        categoryIds: [catMap['토핑']],
        description: '반숙 계란 추가',
      },
      {
        name: '교자',
        price: 5000,
        categoryIds: [catMap['사이드메뉴']],
        description: '바삭한 군만두 6개',
      },
      {
        name: '에다마메',
        price: 4000,
        categoryIds: [catMap['사이드메뉴']],
        description: '소금에 삶은 풋콩',
      },
      {
        name: '콜라',
        price: 2000,
        categoryIds: [catMap['음료']],
        description: '코카콜라 355ml',
      },
      {
        name: '사이다',
        price: 2000,
        categoryIds: [catMap['음료']],
        description: '칠성사이다 355ml',
      },
    ]);
    console.log(`[Seed] 상품 ${products.length}개 생성 완료`);

    // 테이블 생성: 1층 1~5번, 2층 1~3번
    const crypto = require('crypto');
    const tables = [];
    for (let i = 1; i <= 5; i++) {
      tables.push({ number: i, floor: 1, token: crypto.randomBytes(16).toString('hex') });
    }
    for (let i = 1; i <= 3; i++) {
      tables.push({ number: i, floor: 2, token: crypto.randomBytes(16).toString('hex') });
    }
    const createdTables = await Table.insertMany(tables);
    console.log(`[Seed] 테이블 ${createdTables.length}개 생성 완료`);

    // 관리자 계정 생성
    const admin = await Admin.create({
      email: 'admin@table-home.com',
      password: 'password123',
      name: '관리자',
      role: 'owner',
    });
    console.log(`[Seed] 관리자 계정 생성 완료: ${admin.email}`);

    console.log('\n[Seed] === 시드 데이터 생성 완료 ===');
    console.log(`  - 카테고리: ${categories.length}개`);
    console.log(`  - 상품: ${products.length}개`);
    console.log(`  - 테이블: ${createdTables.length}개`);
    console.log(`  - 관리자: ${admin.email}`);
  } catch (error) {
    console.error('[Seed] 에러 발생:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('[Seed] MongoDB 연결 해제');
  }
}

seed();
