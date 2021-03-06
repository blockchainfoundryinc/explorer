var express = require('express')
  , path = require('path')
  , bitcoinapi = require('bitcoin-node-api')
  , favicon = require('static-favicon')
  , logger = require('morgan')
  , cookieParser = require('cookie-parser')
  , bodyParser = require('body-parser')
  , settings = require('./lib/settings')
  , routes = require('./routes/index')
  , lib = require('./lib/explorer')
  , db = require('./lib/database')
  , locale = require('./lib/locale')
  , request = require('request')
  , cors = require('cors')
  , syscoinHelper = require('./lib/syscoin')
  , utils = require('./lib/utils');

var app = express();
app.use(cors());

// bitcoinapi
bitcoinapi.setWalletDetails(settings.wallet);
if (settings.heavy != true) {
  bitcoinapi.setAccess('only', ['getinfo', 'getnetworkhashps', 'getmininginfo', 'getdifficulty', 'getconnectioncount',
    'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction', 'getpeerinfo', 'gettxoutsetinfo', 'sendrawtransaction', 'getchaintips']);
} else {
  // enable additional heavy api calls
  /*
    getvote - Returns the current block reward vote setting.
    getmaxvote - Returns the maximum allowed vote for the current phase of voting.
    getphase - Returns the current voting phase ('Mint', 'Limit' or 'Sustain').
    getreward - Returns the current block reward, which has been decided democratically in the previous round of block reward voting.
    getnextrewardestimate - Returns an estimate for the next block reward based on the current state of decentralized voting.
    getnextrewardwhenstr - Returns string describing how long until the votes are tallied and the next block reward is computed.
    getnextrewardwhensec - Same as above, but returns integer seconds.
    getsupply - Returns the current money supply.
    getmaxmoney - Returns the maximum possible money supply.
  */
  bitcoinapi.setAccess('only', ['getinfo', 'getstakinginfo', 'getnetworkhashps', 'getdifficulty', 'getconnectioncount',
    'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction', 'getmaxmoney', 'getvote', 'getmaxvote', 'getphase',
    'getreward', 'getnextrewardestimate', 'getnextrewardwhenstr', 'getnextrewardwhensec', 'getsupply', 'gettxoutsetinfo',
    'sendrawtransaction', 'getchaintips']);
}
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(favicon(path.join(__dirname, settings.favicon)));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), {maxAge: 15 * 24 * 60 * 60 * 1000}));

// routes
app.use('/api', bitcoinapi.app);
app.use('/', routes);
app.use('/ext/getmoneysupply', function (req, res) {
  lib.get_supply(function (supply) {
    res.send(' ' + supply);
  });
});

// extended API routes
app.use('/ext/sendfrom2', async (req, res, next) => {
  try {
    let rawtx = await syscoinHelper.sendFrom(req.param('fundingAddress'), req.param('address'), req.param('amount'));
    let json = await syscoinHelper.decodeRawTransaction(rawtx.hex);
    let prevOuts = await utils.getPrevOutsFromRawTx(rawtx.hex);
    res.send({ rawtx, prevOuts, json });
  } catch (e) {
    console.log('ERR', e);
    res.status(500).json({ error: e });
  }
});

app.use('/ext/assetallocationsend2', async (req, res) => {
  try {
    let rawtx = await syscoinHelper.assetAllocationSend(req.param('assetGuid'), req.param('senderAddress'), req.param('receiverAddress'), req.param('amount'));
    let json = await syscoinHelper.decodeRawTransaction(rawtx.hex);
    let prevOuts = await utils.getPrevOutsFromRawTx(rawtx.hex);
    res.send({ rawtx, prevOuts, json });
  } catch (e) {
    res.status(500).json({ error: e });
  }
});


app.use('/ext/sendrawtransaction', async (req, res) => {
  try {
    let txid = await syscoinHelper.sendRawTransaction(req.param('hexstring'));
    res.send({ txid });
  } catch (e) {
    res.status(500).json({ error: e });
  }
});

// this takes an array of { txid, index } and returns the input objects reflected by that, mapped to the txid { [txid]: input }
app.use('/ext/getoutputs', async (req, res) => {
  console.log("getinputs:", req.body);

  res.send(await syscoinHelper.getRawTransactionBatch(req.body));
});



app.use('/ext/getaddress/:hash', (req, res) => {
  db.get_address(req.param('hash'), async (address) => {
    if (address) {
      // return asset balance info
      let asset_balances = await utils.buildAssetBalanceList(address);

      // return a better tx list
      let txIds = address.txs.map(entry => {
        return entry.addresses;
      });

      console.log('txid count', txIds.length);
      let last_txs = await syscoinHelper.getTxListDetails(txIds);
      console.log('last_tx count', last_txs.length);

      let a_ext = {
        address: address.a_id,
        sent: (address.sent / 100000000),
        received: (address.received / 100000000),
        balance: (address.balance / 100000000).toString().replace(/(^-+)/mg, ''),
        asset_balances,
        last_txs: last_txs,
      };
      res.send(a_ext);
    } else {
      res.send({error: 'address not found.', hash: req.param('hash')});
    }
  });
});

app.use('/ext/getbalance/:hash', function (req, res) {
  db.get_address(req.param('hash'), function (address) {
    if (address) {
      res.send((address.balance / 100000000).toString().replace(/(^-+)/mg, ''));
    } else {
      res.send({error: 'address not found.', hash: req.param('hash')});
    }
  });
});

app.use('/ext/getdistribution', function (req, res) {
  db.get_richlist(settings.coin, function (richlist) {
    db.get_stats(settings.coin, function (stats) {
      db.get_distribution(richlist, stats, function (dist) {
        res.send(dist);
      });
    });
  });
});

app.use('/ext/getlasttxs/:min', function (req, res) {
  db.get_last_txs(settings.index.last_txs, (req.params.min * 100000000), function (txs) {
    res.send({data: txs});
  });
});

app.use('/ext/connections', function (req, res) {
  db.get_peers(function (peers) {
    res.send({data: peers});
  });
});

app.use('/ext/getchaintips', async function (req, res) {
  let tips = await syscoinHelper.getChainTips();
  res.send(tips);
});

// locals
app.set('title', settings.title);
app.set('symbol', settings.symbol);
app.set('coin', settings.coin);
app.set('locale', locale);
app.set('display', settings.display);
app.set('markets', settings.markets);
app.set('twitter', settings.twitter);
app.set('facebook', settings.youtube);
app.set('googleplus', settings.googleplus);
app.set('youtube', settings.youtube);
app.set('genesis_block', settings.genesis_block);
app.set('index', settings.index);
app.set('heavy', settings.heavy);
app.set('txcount', settings.txcount);
app.set('nethash', settings.nethash);
app.set('nethash_units', settings.nethash_units);
app.set('show_sent_received', settings.show_sent_received);
app.set('logo', settings.logo);
app.set('theme', settings.theme);
app.set('labels', settings.labels);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function (err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function (err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});

module.exports = app;


