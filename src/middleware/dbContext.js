import { poolInterno, poolPublico } from "../config/db.js";

export function useInternalDb(req, _res, next) {
  req.db = poolInterno;
  next();
}

export function usePublicDb(req, _res, next) {
  req.db = poolPublico;
  next();
}
