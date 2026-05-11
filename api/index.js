import "dotenv/config";
import "../src/config/env.js";
import app from "../src/app.js";

export default function handler(req, res) {
  return app(req, res);
}
