function numberWithCommas(x, digits) {
  return parseFloat(x.toFixed(digits)).toLocaleString('en', {minimumFractionDigits : 2, maximumFractionDigits: digits})
}

module.exports = {
  numberWithCommas
};