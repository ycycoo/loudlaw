var crypto = require('crypto');
var util = require('util');

var jsp = require('uglify-js').parser;
var pro = require('uglify-js').uglify;

function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}
var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
'Oct', 'Nov', 'Dec'];

var reg_comma = /\s*,\s*/;
var reg_special = /[-\\\/?!.*+^$\[\]\(\)\{\}\<\>=:|]/ig;
var reg_blank = /\s+/ig;

// Extend string functions
Object.defineProperty(String.prototype, 'ssplit', {
  get: function() {
    return function(seperator, len) {
      seperator = seperator || reg_comma;
      if (typeof seperator == 'string') {
        seperator = new RegExp('\\s\*' + seperator + '\\s\*');
      }
      return this.split(seperator, len);
    };
  },
  enumerable: false
});

Object.defineProperty(Array.prototype, 'unique', {
  get: function() {
    return function() {
      var o = {}, i, l = this.length, r = [];
      for (i = 0; i < l; i++) o[this[i]] = this[i];
      for (i in o) r.push(o[i]);
      return r;
    };
  },
  enumerable: false
});

Object.defineProperty(Array.prototype, 'shuffle', {
  get: function() {
    return function(limit, filt) {
      var array = this.slice();
      var tmp, current, idx, top = array.length;

      if (limit) {
        idx = Math.min(limit, top);
      } else {
        idx = top;
      }

      if (top) while (--idx) {
        current = Math.floor(Math.random() * (top + 1));
        tmp = array[current];
        array[current] = array[idx];
        array[idx] = tmp;
      }

      if (filt) {
        var ret = [], i, j = 0;
        while (i < limit && j < top) {
          if (filt(array[j])) {
            ret[i] = array[j];
            i++;
          }
          j++;
        }
        return ret;
      } else {
        return array.slice(0, limit);
      }
    };
  },
  enumerable: false
});

var colors = {
  debug: 'cyan',
  info: 'green',
  warn: 'yellow',
  error: 'red'
};

module.exports = {
  uglify: function uglify(str, opt) {
    if (global.central && central.conf.debug) return str;
    var ast = jsp.parse(str); // parse code and get the initial AST
    ast = pro.ast_mangle(ast); // get a new AST with mangled names
    ast = pro.ast_squeeze(ast); // get an AST with compression optimizations
    return pro.gen_code(ast, opt); // compressed code here
  },
  applog: function(type) {
    var args = Array.prototype.slice.call(arguments);
    var host = this.hostname ? (this.hostname.cyan + ' ~ ') : '';
    type = type + ' -';
    args[0] = host + type[colors[args[0]]];
    console.log.apply(console, args);
  },
  debug: function(msg) {
    if (central.conf.debug) console.log('[debug]:'.blue, msg);
  },
  log: function(msg) {
    util.log(msg);
  },
  trunc: function trunc(str, len) {
    str = str || '';
    len = len || 50;
    if (str.length > len) {
      return str.slice(0, len) + '..';
    }
    return str;
  },
  highlight: function highlight(str, key) {
    try {
      key = key.trim().replace(reg_special, '\\$0');
      key = key.replace(reg_blank, '|');
      str = str.replace(new RegExp('(' + key + ')', 'ig'), '<span class="h">$1</span>');
    } catch (e) {}
    return str;
  },
  timestamp: function() {
    var d = new Date();
    var time = [pad(d.getHours()),
      pad(d.getMinutes()),
    pad(d.getSeconds())].join(':');
    return [d.getDate(), months[d.getMonth()], time].join(' ');
  },
  md5: function(data, encoding) {
    var hash = crypto.createHash('md5');
    hash.update(data);
    encoding = encoding || 'hex';
    return hash.digest(encoding);
  }
};
