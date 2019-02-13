function numberWithCommas(x, digits) {
  return x.toFixed(digits).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

module.exports = {
  numberWithCommas
};