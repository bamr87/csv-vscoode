// A pipeline script file: export a function that receives { columns, rows }
// (rows are objects; numeric columns are already numbers) plus the helper
// library, and returns the new rows or { columns, rows }.
module.exports = function addRank({ columns, rows }, helpers) {
  const ranked = rows.map((row, i) => ({ rank: i + 1, ...row, stock_value: helpers.format(row.stock_value, 2) }));
  return { columns: ["rank", ...columns], rows: ranked };
};
