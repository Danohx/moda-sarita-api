import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';

const { Pool } = pg;
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const datasetDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
const limit = Math.max(1, Math.min(Number(process.argv[3] || 30), 100));

if (!datasetDir) {
  console.error('Uso: node seed-kaggle-produccion.mjs "RUTA\\myntradataset" 30');
  process.exit(1);
}

const csvPath = path.join(datasetDir, 'styles.csv');
const imagesDir = path.join(datasetDir, 'images');

if (!fs.existsSync(csvPath) || !fs.existsSync(imagesDir)) {
  console.error('La carpeta debe contener styles.csv y la carpeta images.');
  console.error(`Ruta recibida: ${datasetDir}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL_INTERNA;
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const cloudApiKey = process.env.CLOUDINARY_API_KEY;
const cloudApiSecret = process.env.CLOUDINARY_API_SECRET;
const cloudFolder = `${process.env.CLOUDINARY_FOLDER || 'moda-sarita'}/demo-kaggle`;

const missingEnv = [
  ['DATABASE_URL_INTERNA', databaseUrl],
  ['CLOUDINARY_CLOUD_NAME', cloudName],
  ['CLOUDINARY_API_KEY', cloudApiKey],
  ['CLOUDINARY_API_SECRET', cloudApiSecret],
].filter(([, value]) => !value).map(([name]) => name);

if (missingEnv.length) {
  console.error(`Faltan variables en el .env de la API: ${missingEnv.join(', ')}`);
  process.exit(1);
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: cloudApiKey,
  api_secret: cloudApiSecret,
});

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === ',' && !quoted) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field.trim());
      field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field.trim());
    rows.push(row);
  }

  const headers = rows.shift()?.map((header) => header.replace(/^\uFEFF/, '')) || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);
}

function findImage(id) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const candidate = path.join(imagesDir, `${id}.${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const articleMap = new Map([
  ['Dresses', { category: 'Vestidos', singular: 'Vestido', kind: 'ROPA' }],
  ['Tops', { category: 'Blusas y tops', singular: 'Top', kind: 'ROPA' }],
  ['Tshirts', { category: 'Blusas y tops', singular: 'Playera', kind: 'ROPA' }],
  ['Shirts', { category: 'Blusas y tops', singular: 'Blusa', kind: 'ROPA' }],
  ['Tunics', { category: 'Blusas y tops', singular: 'Túnica', kind: 'ROPA' }],
  ['Jeans', { category: 'Pantalones', singular: 'Pantalón de mezclilla', kind: 'ROPA' }],
  ['Trousers', { category: 'Pantalones', singular: 'Pantalón', kind: 'ROPA' }],
  ['Leggings', { category: 'Pantalones', singular: 'Legging', kind: 'ROPA' }],
  ['Skirts', { category: 'Faldas', singular: 'Falda', kind: 'ROPA' }],
  ['Sweaters', { category: 'Suéteres', singular: 'Suéter', kind: 'ROPA' }],
  ['Sweatshirts', { category: 'Suéteres', singular: 'Sudadera', kind: 'ROPA' }],
  ['Jackets', { category: 'Chamarras', singular: 'Chamarra', kind: 'ROPA' }],
  ['Handbags', { category: 'Bolsos', singular: 'Bolso', kind: 'ACCESORIO' }],
  ['Wallets', { category: 'Carteras', singular: 'Cartera', kind: 'ACCESORIO' }],
  ['Clutches', { category: 'Bolsos', singular: 'Bolso de mano', kind: 'ACCESORIO' }],
  ['Heels', { category: 'Calzado', singular: 'Tacón', kind: 'CALZADO' }],
  ['Flats', { category: 'Calzado', singular: 'Balerina', kind: 'CALZADO' }],
  ['Sandals', { category: 'Calzado', singular: 'Sandalia', kind: 'CALZADO' }],
]);

const colorMap = {
  Black: ['Negro', '#000000'],
  White: ['Blanco', '#FFFFFF'],
  Red: ['Rojo', '#D32F2F'],
  Blue: ['Azul', '#1976D2'],
  Navy: ['Azul marino', '#1A237E'],
  Pink: ['Rosa', '#EC1380'],
  Purple: ['Morado', '#7B1FA2'],
  Green: ['Verde', '#388E3C'],
  Yellow: ['Amarillo', '#FBC02D'],
  Orange: ['Naranja', '#F57C00'],
  Brown: ['Café', '#6D4C41'],
  Beige: ['Beige', '#D7CCC8'],
  Grey: ['Gris', '#757575'],
  Maroon: ['Vino', '#7F0000'],
  Gold: ['Dorado', '#C9A227'],
  Silver: ['Plateado', '#BDBDBD'],
  Multi: ['Multicolor', null],
};

function translateColor(baseColour) {
  return colorMap[baseColour] || [baseColour || 'Multicolor', null];
}

function priceFor(category, id) {
  const n = Number(id) || 1;
  const ranges = {
    Vestidos: [399, 899],
    'Blusas y tops': [179, 449],
    Pantalones: [299, 649],
    Faldas: [249, 549],
    'Suéteres': [299, 649],
    Chamarras: [499, 999],
    Bolsos: [299, 799],
    Carteras: [149, 399],
    Calzado: [299, 699],
  };
  const [min, max] = ranges[category] || [199, 599];
  return Math.round((min + (n % (max - min + 1))) / 10) * 10 - 1;
}

function stockFor(id) {
  return 4 + ((Number(id) || 0) % 9);
}

async function getOrCreateCategory(client, name) {
  const slug = slugify(name);
  const existing = await client.query(
    `SELECT id FROM inventario.categorias WHERE lower(nombre) = lower($1) LIMIT 1`,
    [name],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query(
    `INSERT INTO inventario.categorias (nombre, descripcion, slug, activo)
     VALUES ($1, $2, $3, true)
     RETURNING id`,
    [name, `Productos demo de ${name}`, slug],
  );
  return inserted.rows[0].id;
}

async function getOrCreateColor(client, name, hex) {
  const existing = await client.query(
    `SELECT id FROM inventario.colores WHERE lower(nombre) = lower($1) LIMIT 1`,
    [name],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query(
    `INSERT INTO inventario.colores (nombre, hex, activo)
     VALUES ($1, $2, true)
     RETURNING id`,
    [name, hex],
  );
  return inserted.rows[0].id;
}

async function getOrCreateSize(client, kind) {
  const sizeName = kind === 'ACCESORIO' ? 'ÚNICA' : kind === 'CALZADO' ? '24' : 'M';
  const sizeType = kind;
  const existing = await client.query(
    `SELECT id FROM inventario.tallas
     WHERE lower(nombre) = lower($1) AND COALESCE(tipo, '') = $2
     LIMIT 1`,
    [sizeName, sizeType],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query(
    `INSERT INTO inventario.tallas (nombre, tipo, activo)
     VALUES ($1, $2, true)
     RETURNING id`,
    [sizeName, sizeType],
  );
  return inserted.rows[0].id;
}

const csvText = fs.readFileSync(csvPath, 'utf8');
const sourceRows = parseCsv(csvText);

const candidates = sourceRows
  .filter((row) => ['Women', 'Girls'].includes(row.gender))
  .map((row) => ({ row, meta: articleMap.get(row.articleType), image: findImage(row.id) }))
  .filter((item) => item.meta && item.image)
  .sort((a, b) => Number(a.row.id) - Number(b.row.id));

const selected = [];
const byCategory = new Map();
for (const item of candidates) {
  const list = byCategory.get(item.meta.category) || [];
  list.push(item);
  byCategory.set(item.meta.category, list);
}

while (selected.length < limit) {
  let added = false;
  for (const list of byCategory.values()) {
    const item = list.shift();
    if (item) {
      selected.push(item);
      added = true;
      if (selected.length >= limit) break;
    }
  }
  if (!added) break;
}

if (!selected.length) {
  console.error('No se encontraron productos compatibles con imagen.');
  process.exit(1);
}

console.log(`Se importarán ${selected.length} productos a producción.`);
console.log('Las imágenes se subirán a Cloudinary y Neon guardará sus URLs.');

let inserted = 0;
let skipped = 0;
let failed = 0;

for (let index = 0; index < selected.length; index += 1) {
  const { row, meta, image } = selected[index];
  const client = await pool.connect();
  const productSlug = `demo-kaggle-${row.id}`;
  const publicId = `kaggle-${row.id}`;
  let uploaded = null;

  try {
    const exists = await client.query(
      `SELECT id FROM inventario.productos WHERE slug = $1 LIMIT 1`,
      [productSlug],
    );

    if (exists.rows[0]) {
      skipped += 1;
      console.log(`[${index + 1}/${selected.length}] OMITIDO ${productSlug}`);
      client.release();
      continue;
    }

    const [colorName, colorHex] = translateColor(row.baseColour);
    const name = `${meta.singular} ${colorName.toLowerCase()} ${row.id}`;
    const price = priceFor(meta.category, row.id);
    const cost = Math.max(1, Math.round(price * 0.58));
    const stock = stockFor(row.id);

    uploaded = await cloudinary.uploader.upload(image, {
      folder: cloudFolder,
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
      transformation: [
        { width: 1000, height: 1250, crop: 'fill', gravity: 'auto' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    });

    await client.query('BEGIN');

    const categoryId = await getOrCreateCategory(client, meta.category);
    const colorId = await getOrCreateColor(client, colorName, colorHex);
    const sizeId = await getOrCreateSize(client, meta.kind);

    const productResult = await client.query(
      `INSERT INTO inventario.productos
       (nombre, descripcion, categoria_id, activo, slug, destacado, maneja_variantes)
       VALUES ($1, $2, $3, true, $4, $5, true)
       RETURNING id`,
      [
        name,
        `${meta.singular} de demostración para Moda Sarita. Color ${colorName}.`,
        categoryId,
        productSlug,
        index < 8,
      ],
    );

    const productId = productResult.rows[0].id;
    const sku = `DEMO-${row.id}`;

    await client.query(
      `INSERT INTO inventario.variantes_producto
       (producto_id, talla_id, color_id, sku, precio_venta, precio_costo,
        stock_fisico, stock_apartado, stock_minimo, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 2, true)`,
      [productId, sizeId, colorId, sku, price, cost, stock],
    );

    await client.query(
      `INSERT INTO inventario.producto_imagenes
       (producto_id, public_id, url, orden, es_principal)
       VALUES ($1, $2, $3, 0, true)`,
      [productId, uploaded.public_id, uploaded.secure_url],
    );

    await client.query('COMMIT');
    inserted += 1;
    console.log(`[${index + 1}/${selected.length}] CREADO ${name}`);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if (uploaded?.public_id) {
      try { await cloudinary.uploader.destroy(uploaded.public_id); } catch {}
    }
    failed += 1;
    console.error(`[${index + 1}/${selected.length}] ERROR ${row.id}: ${error.message}`);
  } finally {
    client.release();
  }
}

await pool.end();

console.log('\nResultado:');
console.log(`Creados: ${inserted}`);
console.log(`Omitidos: ${skipped}`);
console.log(`Errores: ${failed}`);

if (failed > 0) process.exitCode = 1;
