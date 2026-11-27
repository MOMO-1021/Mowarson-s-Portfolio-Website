import pkg from "../netlify/shared/db.js";
export const { query, withTransaction, getPool, getDatabaseUrl, isPreviewEnvironment, isDbConfigured } = pkg;
