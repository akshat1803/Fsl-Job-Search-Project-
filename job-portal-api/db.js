const sql = require('mssql');
require('dotenv').config();

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '1433'),
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

let pool = null;

async function getPool() {
  if (!pool) {
    console.log(`Connecting to SQL Server at ${config.server} / Database: ${config.database}...`);
    pool = await sql.connect(config);
  }
  return pool;
}

class ConnectionWrapper {
  constructor(pool) {
    this.pool = pool;
    this.transaction = null;
  }

  async beginTransaction() {
    this.transaction = new sql.Transaction(this.pool);
    await this.transaction.begin();
  }

  async commit() {
    if (this.transaction) {
      await this.transaction.commit();
      this.transaction = null;
    }
  }

  async rollback() {
    if (this.transaction) {
      try {
        await this.transaction.rollback();
      } catch (err) {
        console.error('Rollback failed:', err.message);
      }
      this.transaction = null;
    }
  }

  release() {
    // No-op for releasing since transaction is handled locally
  }

  async query(queryText, params = []) {
    const request = this.transaction
      ? new sql.Request(this.transaction)
      : new sql.Request(this.pool);

    let convertedQuery = queryText;

    // 1. Replace MySQL parameter placeholders (?) with SQL Server style (@p1, @p2, ...)
    if (params && params.length > 0) {
      let parts = queryText.split('?');
      convertedQuery = '';
      for (let i = 0; i < params.length; i++) {
        convertedQuery += parts[i] + `@p${i + 1}`;
        request.input(`p${i + 1}`, params[i]);
      }
      convertedQuery += parts[parts.length - 1];
    }

    // 2. Map MySQL boolean literals to SQL Server compatible bit values (1/0)
    convertedQuery = convertedQuery
      .replace(/\bTRUE\b/gi, '1')
      .replace(/\bFALSE\b/gi, '0');

    // 3. Map MySQL functions to SQL Server equivalents
    convertedQuery = convertedQuery.replace(/\bNOW\(\)/gi, 'GETDATE()');

    // Log the converted query for debugging
    // console.log('Executing converted SQL:', convertedQuery);

    const result = await request.query(convertedQuery);

    // MySQL promise wrapper returns [rows, fields]. We mock this using [recordset, null]
    return [result.recordset || [], null];
  }
}

const poolWrapper = {
  async query(queryText, params = []) {
    const activePool = await getPool();
    const conn = new ConnectionWrapper(activePool);
    return conn.query(queryText, params);
  },

  async getConnection() {
    const activePool = await getPool();
    return new ConnectionWrapper(activePool);
  },

  async end() {
    if (pool) {
      await pool.close();
      pool = null;
    }
  }
};

module.exports = poolWrapper;
