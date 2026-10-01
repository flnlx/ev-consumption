const encoder = new TextEncoder();
export async function hashRecords(records) {
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(records)))))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function splitRecords(records) {
  const chunks = [];
  const state = { rows: [], bytes: 2 };
  for (const row of records) {
    const size = encoder.encode(JSON.stringify(row)).byteLength + 1;
    if (size > 120 * 1024) throw new Error("单条记录过大，请缩短备注（单条需小于 120KB）。");
    if (state.rows.length && (state.rows.length >= 256 || state.bytes + size > 120 * 1024)) { chunks.push(state.rows); state.rows = []; state.bytes = 2; }
    state.rows.push(row); state.bytes += size;
  }
  if (state.rows.length) chunks.push(state.rows);
  return chunks;
}
