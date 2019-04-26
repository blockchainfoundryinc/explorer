function numberWithCommas(x, digits) {
  return parseFloat(x.toFixed(digits)).toLocaleString('en', {minimumFractionDigits : 2, maximumFractionDigits: digits})
}

function errorAndExit(msg) {
  console.log(msg);
  throw new Error(msg);
  process.exit(22);
}

module.exports = {
  numberWithCommas,
  errorAndExit
};