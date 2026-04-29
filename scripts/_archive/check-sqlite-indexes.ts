import Database from "better-sqlite3";
const db = new Database("C:/Users/yabis/Desktop/Data Henri 3/permits.db", { readonly: true });
const idx = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='permits'").all();
console.log("Indexes:", JSON.stringify(idx, null, 2));
// Get max first_seen_at quickly — requires index or scan
console.time("max first_seen_at");
const r = db.prepare("SELECT max(first_seen_at) AS mx FROM permits").get();
console.timeEnd("max first_seen_at");
console.log(r);
db.close();
