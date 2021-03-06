var cache = central.cache;
var u_s = central.lib._;
var keysplitter = central.conf.cache.keysplitter;
var util = require('util');

var cradle = require('cradle');
// extend cradle
cradle.Connection.prototype.fti = function(db, design_path) {
  var args = Array.prototype.slice.call(arguments, 2);
  args = ['GET', '_fti/local/' + db + '/_design/' + design_path].concat(args);
  this.request.apply(this, args);
};

/**
* dateset constructor
* @param {object} opt | dateset methods defined in "datesets/".
* @constructor
*/
var Dataset = function(opt) {
  var self = this;

  // init database connection
  if (opt.dbname) {
    var dbconn = central.dbconn;
    var prefix = central.conf.db_prefix;
    var dbname = self.dbname = prefix + opt.dbname;
    var db = self.db = dbconn && dbconn.db(dbname);
    process.nextTick(function() {
      db && db.exists(function(err, exists) {
        if (err) {
          util.debug('[db ' + dbname.red + '] connection ' + err);
          return;
        }
        if (exists) {
          //util.log('[db]: '.green + dbname + ' is ready to serve');
        } else {
          db.create();
          util.log('[db]: '.yellow + dbname + ' creating..');
        }
        function strfy(obj) {
          return JSON.stringify(obj, function(k, item) {
            if (typeof item == 'function') return item.toString();
            return item;
          });
        }

        if (opt._design) {
          var design = opt._design;
          // save design document
          for (var d in design) {
            (function() {
              var id = '_design/' + d;
              var doc = design[d];
              var doc_str = strfy(doc);
              db.get(id, function(err, res) {
                if (err) return;
                var rev = res._rev;
                delete res._rev;
                delete res._id;
                if (strfy(res) == doc_str) return;
                db.save(id, rev, doc, function(err, ret) {
                  if (ret && ret.ok) {
                    util.log('[db]: '.green + dbname + ' design doc updated');
                  } else {
                    util.log(err);
                  }
                });
              });
            })();
          }
        }
      });
    });
  }

  self.gets = opt.gets;
  self.puts = opt.puts;
  self.model = opt.model;
  self.cache_options = opt.cache_options || {};

  // for data bulk update
  if (opt.pulse_interval) {
    self.pulse_interval = opt.pulse_interval || { default: 30 };
    self.pulse_cache = {};
    self.pulse_size = opt.pulse_size || 20;
  }

  return self;
};

Dataset.prototype = {
  lucene: function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(this.dbname);
    var conn = central.dbconn.conn;
    conn.fti.apply(conn, args);
  },
  // get data from cache,
  // if no cache, get raw data.
  fetch: function(key, opt, next) {
    var self = this;
    if (typeof opt == 'function') {
      next = opt;
      opt = null;
    }
    opt = opt || self.cache_options[key[0]];

    var keystr = [self.dbname].concat(key).join(keysplitter);

    // getting data
    cache.read(keystr, opt, function(data) {
      // cache data does not exist
      if (data === undefined) {
        self.rawData(key, opt, next);
      } else {
        var model = (opt && opt.model) || self.model;
        var ret = data ? (model ? new model(data) : data) : data;
        next(null, ret);
      }
    });
  },
  get: function(key) {
    var self = this;
    var keystr = [self.dbname].concat(key).join(keysplitter);
    return cache.get(keystr);
  },
  // save data to cache,
  // and run the raw data update method
  save: function(key, data, opt, next) {
    var self = this;
    var methodName = key[0];
    if (typeof opt == 'function') {
      next = opt;
      opt = self.cache_options[methodName] || {};
    }
    var model = opt.model || self.model;

    self.update(key, data, function(err, ret) {
      //self.unstash(key, true);
      if (ret !== undefined) {
        ret = ret ? ((model && !(ret instanceof model)) ? new model(ret) : ret) : ret;
        self.stash(key, ret);
      }
      next(err, ret);
    });
  },
  // get rawdata
  rawData: function(key, opt, next) {
    var self = this;
    if (typeof opt == 'function') {
      next = opt;
      opt = null;
    }
    var methodName = key[0];
    opt = opt || self.cache_options[methodName];

    // (dataMethod)-_-(arg1)-_-(arg2)...
    //
    // Example key string:
    //
    // sid-_-中华人民共和国宪法
    // list-_-cate-_-32-_-default-_-20-_-10

    // methods to fetch db data
    self.gets[methodName].call(self, key.slice(1), function(err, data) {
      var model = (opt && opt.model) || self.model;
      var ret = model ? (new model(data)) : data;
      next && next(err, ret);
      self.stash(key, data, opt);
    });
  },
  // put into cache
  stash: function(key, data, opt, next) {
    var self = this;
    var methodName = key[0];
    var opt = opt || self.cache_options[methodName];
    var keystr = [self.dbname].concat(key).join(keysplitter);

    // save cache to memory
    cache.save(keystr, data, opt, next);
    // save cache to file
    if (opt && opt.tofile) cache.toFile(keystr, opt);
  },
  // delete cache, support fuzzy matching
  unstash: function(key, keepFile) {
    var self = this;
    var opt = self.cache_options[key[0]];
    if (opt && !opt.tofile) return;
    var keystr = [self.dbname].concat(key).join(keysplitter);
    u_s.each(cache.data, function(val, key) {
      if (key.indexOf(keystr) == 0) cache.delete(key, keepFile);
    });
  },
  // put data into pulse to send (for data with low constensy requirement)
  queue: function(key, data, opt, next) {
    var self = this;

    next && next(data);

    var method = key.shift();
    if (typeof opt == 'function') {
      next = opt;
      opt = {};
    }

    self.stash(key, data, opt);

    var time = self.pulse_interval[method] || self.pulse_interval.default;
    // reset pulse timer
    var resetTimer = opt.resetTimer;
    if (resetTimer) self.stopPulse(method);
    var t = 'pulse_timer_' + method;
    if (!self[t] || resetTimer) {
      self[t] = setTimeout(function() {
        self.sendPulse(method);
      }, time * 1000);
    }
  },
  sendPulse: function(method, next) {
    var self = this;
    var pulse = self.pulse_cache[method];
    var fun = self.puts[method + '_bulk'];
    fun && fun.call(self, pulse, function(err, res) {
      pulse = [];
      console.log(self.pulse_cache[method]);
      next(err, res);
    }); 
  },
  stopPulse: function(method) {
    var t = 'pulse_timer_' + method;
    self[t] && clearTimeout(self[t]);
  },
  // updata data (no cache, do it right away)
  update: function(key, data, next) {
    var self = this;
    var method = key[0];
    self.puts[method].call(self, key.slice(1), data, next);
  }
};

module.exports = Dataset;
