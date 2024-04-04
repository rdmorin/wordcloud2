/*!
 * wordcloud2.js
 * http://timdream.org/wordcloud2.js/
 *
 * Copyright 2011 - 2013 Tim Chien
 * Released under the MIT license
 */

'use strict';

// setImmediate
if (!window.setImmediate) {
  window.setImmediate = (function setupSetImmediate() {
    return window.msSetImmediate ||
    window.webkitSetImmediate ||
    window.mozSetImmediate ||
    window.oSetImmediate ||
    (function setupSetZeroTimeout() {
      if (!window.postMessage || !window.addEventListener) {
        return null;
      }

      var callbacks = [undefined];
      var message = 'zero-timeout-message';

      // Like setTimeout, but only takes a function argument.  There's
      // no time argument (always zero) and no arguments (you have to
      // use a closure).
      var setZeroTimeout = function setZeroTimeout(callback) {
        var id = callbacks.length;
        callbacks.push(callback);
        window.postMessage(message + id.toString(36), '*');

        return id;
      };

      window.addEventListener('message', function setZeroTimeoutMessage(evt) {
        // Skipping checking event source, retarded IE confused this window
        // object with another in the presence of iframe
        if (typeof evt.data !== 'string' ||
            evt.data.substr(0, message.length) !== message/* ||
            evt.source !== window */) {
          return;
        }

        evt.stopImmediatePropagation();

        var id = parseInt(evt.data.substr(message.length), 36);
        if (!callbacks[id]) {
          return;
        }

        callbacks[id]();
        callbacks[id] = undefined;
      }, true);

      /* specify clearImmediate() here since we need the scope */
      window.clearImmediate = function clearZeroTimeout(id) {
        if (!callbacks[id]) {
          return;
        }

        callbacks[id] = undefined;
      };

      return setZeroTimeout;
    })() ||
    // fallback
    function setImmediateFallback(fn) {
      window.setTimeout(fn, 0);
    };
  })();
}

if (!window.clearImmediate) {
  window.clearImmediate = (function setupClearImmediate() {
    return window.msClearImmediate ||
    window.webkitClearImmediate ||
    window.mozClearImmediate ||
    window.oClearImmediate ||
    // "clearZeroTimeout" is implement on the previous block ||
    // fallback
    function clearImmediateFallback(timer) {
      window.clearTimeout(timer);
    };
  })();
}

(function(global) {

  // Check if WordCloud can run on this browser
  var isSupported = (function isSupported() {
    var canvas = document.createElement('canvas');
    if (!canvas || !canvas.getContext) {
      return false;
    }

    var ctx = canvas.getContext('2d');
    if (!ctx.getImageData) {
      return false;
    }
    if (!ctx.fillText) {
      return false;
    }

    if (!Array.prototype.some) {
      return false;
    }
    if (!Array.prototype.push) {
      return false;
    }

    return true;
  }());

  // Find out if the browser impose minium font size by
  // drawing small texts on a canvas and measure it's width.
  var minFontSize = (function getMinFontSize() {
    if (!isSupported) {
      return;
    }

    var ctx = document.createElement('canvas').getContext('2d');

    // start from 20
    var size = 20;

    // two sizes to measure
    var hanWidth, mWidth;

    while (size) {
      ctx.font = size.toString(10) + 'px sans-serif';
      if ((ctx.measureText('\uFF37').width === hanWidth) &&
          (ctx.measureText('m').width) === mWidth) {
        return (size + 1);
      }

      hanWidth = ctx.measureText('\uFF37').width;
      mWidth = ctx.measureText('m').width;

      size--;
    }

    return 0;
  })();

  // Based on http://jsfromhell.com/array/shuffle
  var shuffleArray = function shuffleArray(arr) {
    for (var j, x, i = arr.length; i;
      j = Math.floor(Math.random() * i),
      x = arr[--i], arr[i] = arr[j],
      arr[j] = x) {}
    return arr;
  };

  var WordCloud = function WordCloud(elements, options) {
    if (!isSupported) {
      return;
    }

    if (!Array.isArray(elements)) {
      elements = [elements];
    }

    elements.forEach(function(el, i) {
      if (typeof el === 'string') {
        elements[i] = document.getElementById(el);
        if (!elements[i]) {
          throw 'The element id specified is not found.';
        }
      } else if (!el.tagName && !el.appendChild) {
        throw 'You must pass valid HTML elements, or ID of the element.';
      }
    });

    /* Default values to be overwritten by options object */
    /* Default values to be overwritten by options object */
    var settings = {
      list: [],
      fontFamily: '"Trebuchet MS", "Heiti TC", "微軟正黑體", ' +
                  '"Arial Unicode MS", "Droid Fallback Sans", sans-serif',
      fontWeight: 'normal',
      color: 'random-dark',
      minSize: 0, // 0 to disable
      weightFactor: 1,
      clearCanvas: true,
      backgroundColor: '#fff', // opaque white = rgba(255, 255, 255, 1)

      gridSize: 8,
      drawOutOfBound: false,
      shrinkToFit: false,
      origin: null,

      drawMask: false,
      maskColor: 'rgba(255,0,0,0.3)',
      maskGapWidth: 0.3,

      wait: 0,
      abortThreshold: 0, // disabled
      abort: function noop () {},

      minRotation: -Math.PI / 2,
      maxRotation: Math.PI / 2,
      rotationSteps: 2,

      shuffle: true,
      rotateRatio: 0.1,

      shape: 'circle',
      ellipticity: 0.65,

      classes: null,

      hover: null,
      click: null
    }

    if (options) {
      for (var key in options) {
        if (key in settings) {
          settings[key] = options[key];
        }
      }
    }

    /* Convert weightFactor into a function */
    if (typeof settings.weightFactor !== 'function') {
      var factor = settings.weightFactor;
      settings.weightFactor = function weightFactor(pt) {
        return pt * factor; //in px
      };
    }

    /* Convert shape into a function */
    if (typeof settings.shape !== 'function') {
      switch (settings.shape) {
        case 'circle':
        /* falls through */
        default:
          // 'circle' is the default and a shortcut in the code loop.
          settings.shape = 'circle';
          break;

        case 'cardioid':
          settings.shape = function shapeCardioid(theta) {
            return 1 - Math.sin(theta);
          };
          break;

        /*

        To work out an X-gon, one has to calculate "m",
        where 1/(cos(2*PI/X)+m*sin(2*PI/X)) = 1/(cos(0)+m*sin(0))
        http://www.wolframalpha.com/input/?i=1%2F%28cos%282*PI%2FX%29%2Bm*sin%28
        2*PI%2FX%29%29+%3D+1%2F%28cos%280%29%2Bm*sin%280%29%29

        Copy the solution into polar equation r = 1/(cos(t') + m*sin(t'))
        where t' equals to mod(t, 2PI/X);

        */
        case 'hexagon':
          settings.shape = function shapeHexagon(theta) {
          var max = 213;
          var leng = [211,212,212,212,212,211,211,211,210,210,210,209,208,207,207,206,205,204,203,202,202,201,200,200,199,199,198,198,197,197,196,196,195,195,195,194,194,194,193,193,193,192,192,192,192,192,191,192,191,191,191,191,191,191,192,191,192,192,192,192,192,192,192,193,193,193,193,193,194,194,194,195,195,195,196,196,197,197,198,198,199,200,200,201,202,202,203,204,204,204,205,206,207,209,209,209,210,210,211,211,211,212,212,212,212,212,212,212,212,212,211,211,211,210,210,209,209,208,207,206,205,205,204,203,203,202,201,201,200,199,199,198,198,197,197,196,196,195,195,195,194,194,194,193,193,193,193,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,193,193,193,193,194,194,194,195,195,195,196,196,197,197,198,198,199,199,200,200,201,202,202,203,204,205,205,206,207,208,209,209,210,211,210,210,211,211,211,211,211,211,211,212,212,212,211,211,211,210,210,209,209,209,208,207,206,205,204,203,202,202,202,201,200,199,199,199,198,198,197,197,196,196,195,195,195,194,194,194,193,193,193,193,193,192,192,191,192,192,191,191,192,191,191,191,191,191,191,191,192,192,192,192,192,193,193,193,193,194,194,194,195,195,196,196,196,197,197,198,198,199,199,200,200,201,202,202,203,204,205,205,206,207,208,209,210,209,210,210,211,212,212,212,212,212,212,212,212,212,212,212,211,211,210,210,210,209,208,207,206,206,205,204,203,202,202,201,200,200,199,199,198,198,197,197,196,196,195,195,195,194,194,194,193,193,193,192,192,192,192,191,192,192,191,191,192,191,191,192,192,191,192,192,192,192,192,192,192,192,193,193,193,193,193,194,194,194,195,195,196,196,196,197,198,198,199,199,200,201,201,202,203,204,205,204,205,206,207,208,209,209,210,211,211,210,211,211,211,212,212,212,212,212,212,212,211,211,211,210,210,209,209,208,207,206,206,205,204,203,203,202,201,201,200,199,199,198,198,197,197,196,196,196,195,195,194,194,194,193,193,193,193,193,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,192,193,193,193,193,194,194,194,195,195,195,196,196,197,197,198,198,199,199,200,200,201,202,202,203,204,204,205,206,207,208,209,208,209,210,210,211,211,211,211,211,211,212,212,211,212,212,212,211,211,211,210,209,209,209,208,207,206,205,204,203,203,202,202,201,200,199,200,199,198,198,197,197,196,196,196,195,194,195,194,194,193,193,193,192,193,192,192,191,192,191,191,191,191,191,191,191,191,191,191,192,192,192,192,192,193,193,193,193,194,194,194,193,195,195,195,196,196,197,196,198,198,199,199,200,200,201,202,202,203,204,204,205,206,207,208,209,210,209,210,210,211,211,212,212,212,212,213];
          return leng[(theta / (2 * Math.PI)) * leng.length | 0] / max;
          };
          break;
        case 'hyperbolic':
          settings.shape = function shapeHyperbolic(theta) {
            var max = 171;
            var leng = [160,146,141,133,128,125,122,119,116,113,111,109,108,106,105,102,100,100,98,96,95,95,94,92,92,90,89,89,88,87,86,86,85,84,83,84,82,82,81,81,80,80,79,79,78,78,78,77,77,76,77,75,76,75,75,75,75,74,74,75,74,73,74,73,73,72,73,72,73,72,72,73,72,73,72,73,72,73,72,73,72,73,72,73,72,73,72,73,72,73,72,73,72,73,73,73,74,74,74,75,74,75,75,75,75,76,76,77,77,77,77,78,78,79,79,79,80,81,82,81,82,83,84,83,85,86,86,87,87,89,90,91,91,92,93,95,95,96,98,100,100,102,104,106,107,108,110,113,116,119,122,125,129,133,137,144,154,160,151,145,136,131,127,124,121,118,115,112,110,109,107,105,103,101,100,99,97,96,96,94,92,92,90,90,90,88,87,86,86,86,84,84,83,82,83,81,81,80,80,79,79,78,78,78,77,78,76,77,75,76,75,75,75,75,74,74,73,74,73,74,73,73,72,73,72,73,72,73,72,71,72,71,71,72,71,72,71,72,71,72,71,72,71,72,73,72,73,72,73,72,73,73,73,73,73,74,75,73,74,75,75,75,76,75,76,76,76,77,78,77,78,79,78,79,80,81,80,81,82,83,83,83,85,85,85,86,87,89,89,90,91,91,93,95,94,96,98,99,100,102,104,105,107,107,110,113,115,118,121,124,127,131,138,146,152,162,152,141,136,131,128,124,121,118,115,113,110,109,108,106,104,102,101,100,98,97,96,95,93,93,93,91,90,89,88,88,87,86,85,85,85,83,83,83,82,81,81,81,80,79,79,79,78,78,77,78,77,77,76,76,75,76,76,75,75,75,74,74,75,74,75,74,74,73,74,73,74,73,74,73,74,73,73,73,73,74,73,74,73,73,73,73,74,74,74,74,74,74,75,76,74,75,75,75,76,75,76,77,76,77,78,77,78,77,79,79,80,79,80,81,81,82,82,83,83,84,84,84,85,86,87,87,88,89,90,92,92,92,94,95,96,98,99,99,101,103,105,105,106,109,111,114,116,120,123,126,129,133,137,141,152,171,0,151,144,135,131,127,125,121,119,115,113,110,110,109,108,107,106,103,101,100,99,97,97,95,93,94,93,92,91,92,90,89,90,87,87,85,86,84,84,83,83,82,81,82,80,80,79,80,79,79,78,78,77,78,76,77,76,75,75,74,75,74,74,75,74,75,74,74,74,74,73,74,75,74,75,74,74,75,74,75,73,74,73,74,74,75,74,74,74,75,74,75,75,75,76,75,76,75,76,77,76,76,77,76,78,78,78,78,79,78,80,80,80,81,81,82,82,83,83,84,85,85,86,86,87,88,89,89,90,91,92,92,94,95,96,99,99,99,101,104,106,107,108,109,111,113,116,118,120,123,126,131,137,142,146,152,162];
            return leng[(theta / (2 * Math.PI)) * leng.length | 0] / max;
          };
          break;
        case 'sicklecell':
          settings.shape = function shapeSiclecell(theta){
            var max = 353;
            var leng = 
[36,38,39,38,39,40,37,38,37,38,39,37,38,38,37,39,37,38,39,37,38,38,37,39,38,40,38,37,39,38,37,39,38,38,38,39,39,38,40,39,40,40,39,40,39,41,40,41,42,42,43,44,42,43,44,45,43,44,45,44,46,45,46,45,47,47,48,49,49,50,49,50,51,52,53,54,53,55,56,58,58,60,63,63,64,65,65,66,67,69,70,71,72,73,74,75,78,79,82,85,88,90,93,95,98,102,106,110,112,116,130,143,353,351,349,348,346,344,342,340,339,336,335,333,330,328,326,324,322,320,318,315,313,312,309,307,304,303,300,297,296,293,291,288,286,285,281,280,278,274,272,270,267,265,264,261,258,257,254,252,249,247,244,242,240,238,235,233,231,228,226,224,222,220,219,216,213,212,210,207,206,204,202,200,199,196,195,193,191,190,188,186,184,182,181,179,178,176,175,174,171,169,168,167,165,164,163,161,160,159,158,157,155,154,152,151,151,150,148,147,146,144,143,142,141,141,139,139,138,136,136,135,133,133,132,132,131,130,129,128,128,127,126,125,125,124,123,122,122,121,122,120,120,119,118,118,118,117,116,116,115,116,115,114,114,113,112,112,111,112,111,111,110,110,109,109,108,108,107,107,107,107,107,107,106,106,106,105,105,105,105,104,104,104,104,103,103,103,103,103,103,102,102,103,102,102,103,102,103,103,102,102,102,102,102,102,102,102,102,102,102,102,102,102,102,102,102,102,102,103,102,102,102,102,103,103,103,103,103,104,104,104,105,105,104,104,105,105,106,106,106,107,107,108,107,107,108,108,108,108,109,109,110,110,110,111,111,112,111,112,113,113,114,114,114,115,116,117,117,117,118,118,119,120,120,121,121,121,123,124,123,125,126,126,127,128,128,128,130,130,131,133,133,134,135,136,136,138,138,139,140,141,143,143,145,146,146,147,149,150,151,152,154,155,156,157,158,160,161,163,164,165,167,168,169,172,173,174,175,176,178,181,181,183,185,187,188,190,192,193,195,198,198,201,204,204,207,209,210,212,214,216,218,220,222,224,227,229,231,233,236,238,240,242,244,247,248,251,253,255,256,260,262,263,266,268,270,272,274,277,279,281,284,285,288,291,292,294,296,298,301,303,305,307,309,311,313,315,317,319,321,323,325,327,329,331,332,334,119,115,110,106,104,92,87,83,82,79,76,75,73,72,70,69,68,67,66,65,64,63,64,62,61,60,58,57,58,55,54,55,53,53,51,50,51,49,50,47,48,46,46,47,45,45,44,45,43,42,43,44,41,41,42,43,40,40,41,42,39,39,40,40,39,40,38,39,40,38,39,37,38,37,38,39,37,38,36,37,38,37,38,39,37,38,39,37,37,36,37,38,36,37,38,36,37,36,37,38,37,38,39,37,38,39,37,38,38,39,40];

            return leng[(theta / (2 * Math.PI)) * leng.length | 0] / max;
          };
          break;

        case 'droplet':
          settings.shape = function shapeDroplet(theta) {
            var max = 1011;
            var leng = [616,615,613,611,608,606,605,602,600,599,596,595,594,591,590,588,587,585,584,583,581,580,578,578,576,575,574,573,572,571,570,570,568,567,567,566,566,565,565,564,563,563,562,562,562,561,561,561,561,561,561,561,561,561,561,561,561,563,563,563,563,563,564,565,566,566,567,567,568,570,571,572,573,574,575,576,577,578,580,581,582,584,586,588,588,590,593,593,596,598,600,602,604,607,609,612,614,617,619,623,625,627,630,634,637,640,644,647,650,654,657,661,665,670,673,678,681,686,690,695,700,705,710,715,720,726,732,737,742,749,755,761,769,775,782,789,796,803,811,819,828,835,844,853,862,871,881,891,901,911,922,934,945,956,970,983,996,1010,998,985,972,959,948,935,925,913,903,892,882,874,863,855,846,837,828,820,813,804,797,790,783,776,769,762,756,750,743,738,732,726,720,715,710,705,701,696,691,686,682,678,674,670,666,662,659,654,651,647,644,640,637,634,631,628,625,622,620,617,615,612,610,608,605,603,601,598,597,595,592,591,589,587,585,584,583,581,580,578,577,576,574,573,572,571,570,569,569,568,567,567,566,564,564,564,564,563,562,562,562,562,561,561,561,561,561,561,561,561,561,562,561,562,563,563,563,563,564,565,565,566,567,567,569,569,570,571,572,573,574,575,576,577,579,579,581,582,584,585,587,588,589,592,593,595,597,598,600,602,604,606,608,610,612,615,617,619,621,623,626,628,630,633,634,637,640,642,645,648,650,653,656,658,661,663,666,669,671,674,677,679,682,684,687,690,693,695,699,701,704,707,711,713,716,720,723,726,729,733,736,740,743,746,750,754,757,761,764,767,771,775,779,782,785,789,793,797,801,804,808,813,816,819,823,827,831,834,838,842,846,850,853,856,860,864,868,871,875,878,882,885,888,891,895,899,902,904,907,911,913,916,920,923,925,927,930,933,936,938,941,943,946,948,949,952,954,957,958,960,962,964,965,968,969,971,972,974,975,977,979,980,982,983,985,986,988,989,990,991,993,994,996,997,998,999,1000,1002,1002,1004,1004,1005,1006,1007,1007,1008,1008,1008,1009,1009,1010,1010,1010,1011,0,1010,1010,1009,1010,1009,1009,1008,1007,1006,1006,1005,1005,1004,1002,1002,1001,999,998,998,996,995,993,992,991,989,988,987,985,984,983,981,980,978,977,975,974,972,970,968,967,964,963,961,959,957,955,953,951,949,946,944,942,939,937,934,932,929,927,924,921,918,915,912,910,906,902,899,896,893,890,886,883,880,876,873,869,865,862,859,855,851,847,843,840,836,832,829,825,821,818,814,810,806,802,799,795,792,788,784,780,776,773,769,766,762,759,754,752,748,745,741,738,734,731,728,725,722,719,715,712,709,706,703,700,697,694,691,689,686,683,680,677,675,672,670,667,665,662,659,656,654,651,649,646,644,641,638,636,634,631,629,627,624,622,620,618];
          
            return leng[(theta / (2 * Math.PI)) * leng.length | 0] / max;
          };
          break;

        case 'brain':
          settings.shape = function shapeBrain(theta) {
            var max = 445;
            var leng = [414,413,411,412,413,414,414,415,414,413,413,411,409,407,406,410,412,413,415,416,417,417,417,416,415,414,412,410,408,404,404,405,406,406,407,407,407,407,408,408,409,408,408,407,406,404,403,399,397,395,393,391,392,393,394,394,394,393,392,391,391,390,389,388,386,385,383,380,376,374,372,371,371,371,372,372,372,372,372,372,373,374,375,376,377,377,377,376,375,374,372,371,369,369,369,370,371,371,372,371,372,371,372,372,372,372,372,372,371,371,370,368,367,365,365,364,364,362,361,360,359,359,357,357,355,354,352,351,351,351,351,351,350,350,349,348,347,346,347,346,347,347,346,347,346,346,345,344,343,343,343,345,347,348,349,349,350,350,349,349,348,347,346,346,347,348,348,348,348,347,346,346,344,344,343,344,346,349,352,355,357,359,360,362,362,363,363,363,363,362,361,360,358,357,360,362,365,366,368,370,370,371,371,372,371,370,370,369,367,369,371,374,375,377,378,378,379,379,379,379,378,377,375,374,374,377,379,382,384,385,387,388,389,388,388,388,387,386,385,384,387,390,392,393,395,395,396,396,396,396,395,394,393,391,392,392,394,395,395,395,395,394,393,392,392,392,392,392,392,391,392,392,392,391,391,390,390,390,390,389,391,393,394,395,395,395,395,395,394,393,392,390,388,387,386,387,389,392,394,395,396,397,397,397,397,396,396,395,392,390,388,385,381,378,377,375,374,371,368,366,361,355,349,322,315,309,304,298,290,288,285,283,280,276,273,269,267,262,258,252,248,245,240,235,231,224,220,217,210,207,202,199,197,192,190,186,182,178,174,170,164,163,164,164,165,165,166,166,167,168,169,169,170,171,171,173,173,174,174,175,175,177,177,177,178,179,179,179,179,180,180,180,181,181,181,182,182,181,182,182,182,182,183,182,182,182,182,182,182,182,182,182,182,182,182,182,182,182,182,182,183,183,183,183,184,183,183,183,183,183,183,183,185,185,186,186,186,185,186,186,188,188,189,190,190,191,192,192,193,193,194,194,195,197,198,199,203,204,204,205,205,210,215,218,222,226,230,235,238,240,243,246,248,251,254,255,257,259,261,262,264,265,266,267,269,270,271,274,275,279,281,286,292,300,309,438,440,441,442,443,445,445,444,443,440,434,425,411,397,387,378,371,365,361,357,353,351,348,347,345,343,342,341,341,341,341,342,342,342,343,344,345,347,348,349,351,353,356,357,359,360,361,361,362,362,362,361,360,360,359,358,357,357,359,362,366,369,371,374,375,377,378,380,380,380,383,388,392,395,398,401,403,406,409,410,412,414,415,416,416,417,419,419,420,420,420,421,421,421,422,422,423,427,431,434,437,438,440,441,441,441,441,440,438,436,435,434,433,432,431,430,429,428,428,426,426,426,425,424,423,424,424,423,422,421,419,418,416,415];
            return leng[(theta / (2 * Math.PI)) * leng.length | 0] / max;
          };
          break;

        case 'diamond':
        case 'square':
          // http://www.wolframalpha.com/input/?i=plot+r+%3D+1%2F%28cos%28mod+
          // %28t%2C+PI%2F2%29%29%2Bsin%28mod+%28t%2C+PI%2F2%29%29%29%2C+t+%3D
          // +0+..+2*PI
          settings.shape = function shapeSquare(theta) {
            var thetaPrime = theta % (2 * Math.PI / 4);
            return 1 / (Math.cos(thetaPrime) + Math.sin(thetaPrime));
          };
          break;

        case 'triangle-forward':
          // http://www.wolframalpha.com/input/?i=plot+r+%3D+1%2F%28cos%28mod+
          // %28t%2C+2*PI%2F3%29%29%2Bsqrt%283%29sin%28mod+%28t%2C+2*PI%2F3%29
          // %29%29%2C+t+%3D+0+..+2*PI
          settings.shape = function shapeTriangle(theta) {
            var thetaPrime = theta % (2 * Math.PI / 3);
            return 1 / (Math.cos(thetaPrime) +
                        Math.sqrt(3) * Math.sin(thetaPrime));
          };
          break;

        case 'triangle':
        case 'triangle-upright':
          settings.shape = function shapeTriangle(theta) {
            var thetaPrime = (theta + Math.PI * 3 / 2) % (2 * Math.PI / 3);
            return 1 / (Math.cos(thetaPrime) +
                        Math.sqrt(3) * Math.sin(thetaPrime));
          };
          break;

        case 'pentagon':
          settings.shape = function shapePentagon(theta) {
            var thetaPrime = (theta + 0.955) % (2 * Math.PI / 5);
            return 1 / (Math.cos(thetaPrime) +
                        0.726543 * Math.sin(thetaPrime));
          };
          break;

        case 'star':
          settings.shape = function shapeStar(theta) {
            var thetaPrime = (theta + 0.955) % (2 * Math.PI / 10);
            if ((theta + 0.955) % (2 * Math.PI / 5) - (2 * Math.PI / 10) >= 0) {
              return 1 / (Math.cos((2 * Math.PI / 10) - thetaPrime) +
                          3.07768 * Math.sin((2 * Math.PI / 10) - thetaPrime));
            } else {
              return 1 / (Math.cos(thetaPrime) +
                          3.07768 * Math.sin(thetaPrime));
            }
          };
          break;
      }
    }

    /* Make sure gridSize is a whole number and is not smaller than 4px */
    settings.gridSize = Math.max(Math.floor(settings.gridSize), 4);

    /* shorthand */
    var g = settings.gridSize;
    var maskRectWidth = g - settings.maskGapWidth;

    /* normalize rotation settings */
    var rotationRange = Math.abs(settings.maxRotation - settings.minRotation);
    var rotationSteps = Math.abs(Math.floor(settings.rotationSteps));
    var minRotation = Math.min(settings.maxRotation, settings.minRotation);

    /* information/object available to all functions, set when start() */
    var grid, // 2d array containing filling information
      ngx, ngy, // width and height of the grid
      center, // position of the center of the cloud
      maxRadius;

    /* timestamp for measuring each putWord() action */
    var escapeTime;

    /* function for getting the color of the text */
    var getTextColor;
    function random_hsl_color(min, max) {
      return 'hsl(' +
        (Math.random() * 360).toFixed() + ',' +
        (Math.random() * 30 + 70).toFixed() + '%,' +
        (Math.random() * (max - min) + min).toFixed() + '%)';
    }
    switch (settings.color) {
      case 'random-dark':
        getTextColor = function getRandomDarkColor() {
          return random_hsl_color(10, 50);
        };
        break;

      case 'random-light':
        getTextColor = function getRandomLightColor() {
          return random_hsl_color(50, 90);
        };
        break;

      default:
        if (typeof settings.color === 'function') {
          getTextColor = settings.color;
        }
        break;
    }

    /* function for getting the classes of the text */
    var getTextClasses = null;
    if (typeof settings.classes === 'function') {
      getTextClasses = settings.classes;
    }

    /* Interactive */
    var interactive = false;
    var infoGrid = [];
    var hovered;

    var getInfoGridFromMouseTouchEvent =
    function getInfoGridFromMouseTouchEvent(evt) {
      var canvas = evt.currentTarget;
      var rect = canvas.getBoundingClientRect();
      var clientX;
      var clientY;
      /** Detect if touches are available */
      if (evt.touches) {
        clientX = evt.touches[0].clientX;
        clientY = evt.touches[0].clientY;
      } else {
        clientX = evt.clientX;
        clientY = evt.clientY;
      }
      var eventX = clientX - rect.left;
      var eventY = clientY - rect.top;

      var x = Math.floor(eventX * ((canvas.width / rect.width) || 1) / g);
      var y = Math.floor(eventY * ((canvas.height / rect.height) || 1) / g);

      return infoGrid[x][y];
    };

    var wordcloudhover = function wordcloudhover(evt) {
      var info = getInfoGridFromMouseTouchEvent(evt);

      if (hovered === info) {
        return;
      }

      hovered = info;
      if (!info) {
        settings.hover(undefined, undefined, evt);

        return;
      }

      settings.hover(info.item, info.dimension, evt);

    };

    var wordcloudclick = function wordcloudclick(evt) {
      var info = getInfoGridFromMouseTouchEvent(evt);
      if (!info) {
        return;
      }

      settings.click(info.item, info.dimension, evt);
      evt.preventDefault();
    };

    /* Get points on the grid for a given radius away from the center */
    var pointsAtRadius = [];
    var getPointsAtRadius = function getPointsAtRadius(radius) {
      if (pointsAtRadius[radius]) {
        return pointsAtRadius[radius];
      }

      // Look for these number of points on each radius
      var T = radius * 8;

      // Getting all the points at this radius
      var t = T;
      var points = [];

      if (radius === 0) {
        points.push([center[0], center[1], 0]);
      }

      while (t--) {
        // distort the radius to put the cloud in shape
        var rx = 1;
        if (settings.shape !== 'circle') {
          rx = settings.shape(t / T * 2 * Math.PI); // 0 to 1
        }

        // Push [x, y, t]; t is used solely for getTextColor()
        points.push([
          center[0] + radius * rx * Math.cos(-t / T * 2 * Math.PI),
          center[1] + radius * rx * Math.sin(-t / T * 2 * Math.PI) *
            settings.ellipticity,
          t / T * 2 * Math.PI]);
      }

      pointsAtRadius[radius] = points;
      return points;
    };

    /* Return true if we had spent too much time */
    var exceedTime = function exceedTime() {
      return ((settings.abortThreshold > 0) &&
        ((new Date()).getTime() - escapeTime > settings.abortThreshold));
    };

    /* Get the deg of rotation according to settings, and luck. */
    var getRotateDeg = function getRotateDeg() {
      if (settings.rotateRatio === 0) {
        return 0;
      }

      if (Math.random() > settings.rotateRatio) {
        return 0;
      }

      if (rotationRange === 0) {
        return minRotation;
      }
      if (rotationSteps > 0) {
        // Min rotation + zero or more steps * span of one step
        return minRotation +
          Math.floor(Math.random() * rotationSteps) *
          rotationRange / (rotationSteps)
      } else {
        return minRotation + Math.random() * rotationRange
      }
    };

    var getTextInfo = function getTextInfo(word, weight, rotateDeg) {
      // calculate the acutal font size
      // fontSize === 0 means weightFactor function wants the text skipped,
      // and size < minSize means we cannot draw the text.
      var debug = false;
      var fontSize = settings.weightFactor(weight);
      if (fontSize <= settings.minSize) {
        return false;
      }

      // Scale factor here is to make sure fillText is not limited by
      // the minium font size set by browser.
      // It will always be 1 or 2n.
      var mu = 1;
      if (fontSize < minFontSize) {
        mu = (function calculateScaleFactor() {
          var mu = 2;
          while (mu * fontSize < minFontSize) {
            mu += 2;
          }
          return mu;
        })();
      }

      var fcanvas = document.createElement('canvas');
      var fctx = fcanvas.getContext('2d', { willReadFrequently: true });

      fctx.font = settings.fontWeight + ' ' +
        (fontSize * mu).toString(10) + 'px ' + settings.fontFamily;

      // Estimate the dimension of the text with measureText().
      var fw = fctx.measureText(word).width / mu;
      var fh = Math.max(fontSize * mu,
                        fctx.measureText('m').width,
                        fctx.measureText('\uFF37').width) / mu;

      // Create a boundary box that is larger than our estimates,
      // so text don't get cut of (it sill might)
      var boxWidth = fw + fh * 2;
      var boxHeight = fh * 3;
      var fgw = Math.ceil(boxWidth / g);
      var fgh = Math.ceil(boxHeight / g);
      boxWidth = fgw * g;
      boxHeight = fgh * g;

      // Calculate the proper offsets to make the text centered at
      // the preferred position.

      // This is simply half of the width.
      var fillTextOffsetX = - fw / 2;
      // Instead of moving the box to the exact middle of the preferred
      // position, for Y-offset we move 0.4 instead, so Latin alphabets look
      // vertical centered.
      var fillTextOffsetY = - fh * 0.4;

      // Calculate the actual dimension of the canvas, considering the rotation.
      var cgh = Math.ceil((boxWidth * Math.abs(Math.sin(rotateDeg)) +
                           boxHeight * Math.abs(Math.cos(rotateDeg))) / g);
      var cgw = Math.ceil((boxWidth * Math.abs(Math.cos(rotateDeg)) +
                           boxHeight * Math.abs(Math.sin(rotateDeg))) / g);
      var width = cgw * g;
      var height = cgh * g;

      fcanvas.setAttribute('width', width);
      fcanvas.setAttribute('height', height);

      if (debug) {
        // Attach fcanvas to the DOM
        document.body.appendChild(fcanvas);
        // Save it's state so that we could restore and draw the grid correctly.
        fctx.save();
      }

      // Scale the canvas with |mu|.
      fctx.scale(1 / mu, 1 / mu);
      fctx.translate(width * mu / 2, height * mu / 2);
      fctx.rotate(- rotateDeg);

      // Once the width/height is set, ctx info will be reset.
      // Set it again here.
      fctx.font = settings.fontWeight + ' ' +
        (fontSize * mu).toString(10) + 'px ' + settings.fontFamily;

      // Fill the text into the fcanvas.
      // XXX: We cannot because textBaseline = 'top' here because
      // Firefox and Chrome uses different default line-height for canvas.
      // Please read https://bugzil.la/737852#c6.
      // Here, we use textBaseline = 'middle' and draw the text at exactly
      // 0.5 * fontSize lower.
      fctx.fillStyle = '#000';
      fctx.textBaseline = 'middle';
      fctx.fillText(word, fillTextOffsetX * mu,
                    (fillTextOffsetY + fontSize * 0.5) * mu);

      // Get the pixels of the text
      var imageData = fctx.getImageData(0, 0, width, height).data;

      if (exceedTime()) {
        return false;
      }

      if (debug) {
        // Draw the box of the original estimation
        fctx.strokeRect(fillTextOffsetX * mu,
                        fillTextOffsetY, fw * mu, fh * mu);
        fctx.restore();
      }

      // Read the pixels and save the information to the occupied array
      var occupied = [];
      var gx = cgw, gy, x, y;
      var bounds = [cgh / 2, cgw / 2, cgh / 2, cgw / 2];
      while (gx--) {
        gy = cgh;
        while (gy--) {
          y = g;
          singleGridLoop: {
            while (y--) {
              x = g;
              while (x--) {
                if (imageData[((gy * g + y) * width +
                               (gx * g + x)) * 4 + 3]) {
                  occupied.push([gx, gy]);

                  if (gx < bounds[3]) {
                    bounds[3] = gx;
                  }
                  if (gx > bounds[1]) {
                    bounds[1] = gx;
                  }
                  if (gy < bounds[0]) {
                    bounds[0] = gy;
                  }
                  if (gy > bounds[2]) {
                    bounds[2] = gy;
                  }

                  if (debug) {
                    fctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
                    fctx.fillRect(gx * g, gy * g, g - 0.5, g - 0.5);
                  }
                  break singleGridLoop;
                }
              }
            }
            if (debug) {
              fctx.fillStyle = 'rgba(0, 0, 255, 0.5)';
              fctx.fillRect(gx * g, gy * g, g - 0.5, g - 0.5);
            }
          }
        }
      }

      if (debug) {
        fctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
        fctx.fillRect(bounds[3] * g,
                      bounds[0] * g,
                      (bounds[1] - bounds[3] + 1) * g,
                      (bounds[2] - bounds[0] + 1) * g);
      }

      // Return information needed to create the text on the real canvas
      return {
        mu: mu,
        occupied: occupied,
        bounds: bounds,
        gw: cgw,
        gh: cgh,
        fillTextOffsetX: fillTextOffsetX,
        fillTextOffsetY: fillTextOffsetY,
        fillTextWidth: fw,
        fillTextHeight: fh,
        fontSize: fontSize
      };
    };

    /* Determine if there is room available in the given dimension */
    var canFitText = function canFitText(gx, gy, gw, gh, occupied) {
      // Go through the occupied points,
      // return false if the space is not available.
      var i = occupied.length;
      while (i--) {
        var px = gx + occupied[i][0];
        var py = gy + occupied[i][1];

        if (px >= ngx || py >= ngy || px < 0 || py < 0 || !grid[px][py]) {
          return false;
        }
      }
      return true;
    };

    /* Actually draw the text on the grid */
    var drawText = function drawText(gx, gy, info, word, weight,
                                     distance, theta, rotateDeg, attributes) {

      var fontSize = info.fontSize;
      var color;
      if (getTextColor) {
        color = getTextColor(word, weight, fontSize, distance, theta);
      } else if (settings.color instanceof Array) {
        color = settings.color.shift() || 'black'; // pass a array in setting, default 'black'
      } else {
        color = settings.color;
      }

      var classes;
      if (getTextClasses) {
        classes = getTextClasses(word, weight, fontSize, distance, theta);
      } else {
        classes = settings.classes;
      }

      var dimension;
      var bounds = info.bounds;
      dimension = {
        x: (gx + bounds[3]) * g,
        y: (gy + bounds[0]) * g,
        w: (bounds[1] - bounds[3] + 1) * g,
        h: (bounds[2] - bounds[0] + 1) * g
      };

      elements.forEach(function(el) {
        if (el.getContext) {
          var ctx = el.getContext('2d');
          var mu = info.mu;

          // Save the current state before messing it
          ctx.save();
          ctx.scale(1 / mu, 1 / mu);

          ctx.font = settings.fontWeight + ' ' +
                     (fontSize * mu).toString(10) + 'px ' + settings.fontFamily;
          ctx.fillStyle = color;

          // Translate the canvas position to the origin coordinate of where
          // the text should be put.
          ctx.translate((gx + info.gw / 2) * g * mu,
                        (gy + info.gh / 2) * g * mu);

          if (rotateDeg !== 0) {
            ctx.rotate(- rotateDeg);
          }

          // Finally, fill the text.

          // XXX: We cannot because textBaseline = 'top' here because
          // Firefox and Chrome uses different default line-height for canvas.
          // Please read https://bugzil.la/737852#c6.
          // Here, we use textBaseline = 'middle' and draw the text at exactly
          // 0.5 * fontSize lower.
          ctx.textBaseline = 'middle';
          ctx.fillText(word, info.fillTextOffsetX * mu,
                             (info.fillTextOffsetY + fontSize * 0.5) * mu);

          // The below box is always matches how <span>s are positioned
          /* ctx.strokeRect(info.fillTextOffsetX, info.fillTextOffsetY,
            info.fillTextWidth, info.fillTextHeight); */

          // Restore the state.
          ctx.restore();
        } else {
          // drawText on DIV element
          var span = document.createElement('span');
          var transformRule = '';
          transformRule = 'rotate(' + (- rotateDeg / Math.PI * 180) + 'deg) ';
          if (info.mu !== 1) {
            transformRule +=
              'translateX(-' + (info.fillTextWidth / 4) + 'px) ' +
              'scale(' + (1 / info.mu) + ')';
          }
          var styleRules = {
            'position': 'absolute',
            'display': 'block',
            'font': settings.fontWeight + ' ' +
                    (fontSize * info.mu) + 'px ' + settings.fontFamily,
            'left': ((gx + info.gw / 2) * g + info.fillTextOffsetX) + 'px',
            'top': ((gy + info.gh / 2) * g + info.fillTextOffsetY) + 'px',
            'width': info.fillTextWidth + 'px',
            'height': info.fillTextHeight + 'px',
            'lineHeight': fontSize + 'px',
            'whiteSpace': 'nowrap',
            'transform': transformRule,
            'webkitTransform': transformRule,
            'msTransform': transformRule,
            'transformOrigin': '50% 40%',
            'webkitTransformOrigin': '50% 40%',
            'msTransformOrigin': '50% 40%'
          };
          if (color) {
            styleRules.color = color;
          }
          span.textContent = word;
          for (var cssProp in styleRules) {
            span.style[cssProp] = styleRules[cssProp];
          }
          if (attributes) {
            for (var attribute in attributes) {
              span.setAttribute(attribute, attributes[attribute]);
            }
          }
          if (classes) {
            span.className += classes;
          }
          el.appendChild(span);
        }
      });
    };

    /* Help function to updateGrid */
    var fillGridAt = function fillGridAt(x, y, drawMask, dimension, item) {
      if (x >= ngx || y >= ngy || x < 0 || y < 0) {
        return;
      }

      grid[x][y] = false;

      if (drawMask) {
        var ctx = elements[0].getContext('2d');
        ctx.fillRect(x * g, y * g, maskRectWidth, maskRectWidth);
      }

      if (interactive) {
        infoGrid[x][y] = { item: item, dimension: dimension };
      }
    };

    /* Update the filling information of the given space with occupied points.
       Draw the mask on the canvas if necessary. */
    var updateGrid = function updateGrid(gx, gy, gw, gh, info, item) {
      var occupied = info.occupied;
      var drawMask = settings.drawMask;
      var ctx;
      if (drawMask) {
        ctx = elements[0].getContext('2d');
        ctx.save();
        ctx.fillStyle = settings.maskColor;
      }

      var dimension;
      if (interactive) {
        var bounds = info.bounds;
        dimension = {
          x: (gx + bounds[3]) * g,
          y: (gy + bounds[0]) * g,
          w: (bounds[1] - bounds[3] + 1) * g,
          h: (bounds[2] - bounds[0] + 1) * g
        };
      }

      var i = occupied.length;
      while (i--) {
        fillGridAt(gx + occupied[i][0], gy + occupied[i][1],
                   drawMask, dimension, item);
      }

      if (drawMask) {
        ctx.restore();
      }
    };

    /* putWord() processes each item on the list,
       calculate it's size and determine it's position, and actually
       put it on the canvas. */
    var putWord = function putWord(item) {
      var word, weight, attributes;
      if (Array.isArray(item)) {
        word = item[0];
        weight = item[1];
      } else {
        word = item.word;
        weight = item.weight;
        attributes = item.attributes;
      }
      var rotateDeg = getRotateDeg();

      // get info needed to put the text onto the canvas
      var info = getTextInfo(word, weight, rotateDeg);

      // not getting the info means we shouldn't be drawing this one.
      if (!info) {
        return false;
      }

      if (exceedTime()) {
        return false;
      }

      // Skip the loop if we have already know the bounding box of
      // word is larger than the canvas.
      var bounds = info.bounds;
      if ((bounds[1] - bounds[3] + 1) > ngx ||
        (bounds[2] - bounds[0] + 1) > ngy) {
        return false;
      }

      // Determine the position to put the text by
      // start looking for the nearest points
      var r = maxRadius + 1;

      var tryToPutWordAtPoint = function(gxy) {
        var gx = Math.floor(gxy[0] - info.gw / 2);
        var gy = Math.floor(gxy[1] - info.gh / 2);
        var gw = info.gw;
        var gh = info.gh;

        // If we cannot fit the text at this position, return false
        // and go to the next position.
        if (!canFitText(gx, gy, gw, gh, info.occupied)) {
          return false;
        }

        // Actually put the text on the canvas
        drawText(gx, gy, info, word, weight,
                 (maxRadius - r), gxy[2], rotateDeg, attributes);

        // Mark the spaces on the grid as filled
        updateGrid(gx, gy, gw, gh, info, item);

        // Return true so some() will stop and also return true.
        return true;
      };

      while (r--) {
        var points = getPointsAtRadius(maxRadius - r);

        if (settings.shuffle) {
          points = [].concat(points);
          shuffleArray(points);
        }

        // Try to fit the words by looking at each point.
        // array.some() will stop and return true
        // when putWordAtPoint() returns true.
        // If all the points returns false, array.some() returns false.
        var drawn = points.some(tryToPutWordAtPoint);

        if (drawn) {
          // leave putWord() and return true
          return true;
        }
      }
      // we tried all distances but text won't fit, return false
      return false;
    };

    /* Send DOM event to all elements. Will stop sending event and return
       if the previous one is canceled (for cancelable events). */
    var sendEvent = function sendEvent(type, cancelable, detail) {
      if (cancelable) {
        return !elements.some(function(el) {
          var evt = document.createEvent('CustomEvent');
          evt.initCustomEvent(type, true, cancelable, detail || {});
          return !el.dispatchEvent(evt);
        }, this);
      } else {
        elements.forEach(function(el) {
          var evt = document.createEvent('CustomEvent');
          evt.initCustomEvent(type, true, cancelable, detail || {});
          el.dispatchEvent(evt);
        }, this);
      }
    };

    /* Start drawing on a canvas */
    var start = function start() {
      // For dimensions, clearCanvas etc.,
      // we only care about the first element.
      var canvas = elements[0];

      if (canvas.getContext) {
        ngx = Math.floor(canvas.width / g);
        ngy = Math.floor(canvas.height / g);
      } else {
        var rect = canvas.getBoundingClientRect();
        ngx = Math.floor(rect.width / g);
        ngy = Math.floor(rect.height / g);
      }

      // Sending a wordcloudstart event which cause the previous loop to stop.
      // Do nothing if the event is canceled.
      if (!sendEvent('wordcloudstart', true)) {
        return;
      }

      // Determine the center of the word cloud
      center = (settings.origin) ?
        [settings.origin[0]/g, settings.origin[1]/g] :
        [ngx / 2, ngy / 2];

      // Maxium radius to look for space
      maxRadius = Math.floor(Math.sqrt(ngx * ngx + ngy * ngy));

      /* Clear the canvas only if the clearCanvas is set,
         if not, update the grid to the current canvas state */
      grid = [];

      var gx, gy, i;
      if (!canvas.getContext || settings.clearCanvas) {
        elements.forEach(function(el) {
          if (el.getContext) {
            var ctx = el.getContext('2d');
            ctx.fillStyle = settings.backgroundColor;
            ctx.clearRect(0, 0, ngx * (g + 1), ngy * (g + 1));
            ctx.fillRect(0, 0, ngx * (g + 1), ngy * (g + 1));
          } else {
            el.textContent = '';
            el.style.backgroundColor = settings.backgroundColor;
          }
        });

        /* fill the grid with empty state */
        gx = ngx;
        while (gx--) {
          grid[gx] = [];
          gy = ngy;
          while (gy--) {
            grid[gx][gy] = true;
          }
        }
      } else {
        /* Determine bgPixel by creating
           another canvas and fill the specified background color. */
        var bctx = document.createElement('canvas').getContext('2d');

        bctx.fillStyle = settings.backgroundColor;
        bctx.fillRect(0, 0, 1, 1);
        var bgPixel = bctx.getImageData(0, 0, 1, 1).data;

        /* Read back the pixels of the canvas we got to tell which part of the
           canvas is empty.
           (no clearCanvas only works with a canvas, not divs) */
        var imageData =
          canvas.getContext('2d').getImageData(0, 0, ngx * g, ngy * g).data;

        gx = ngx;
        var x, y;
        while (gx--) {
          grid[gx] = [];
          gy = ngy;
          while (gy--) {
            y = g;
            singleGridLoop: while (y--) {
              x = g;
              while (x--) {
                i = 4;
                while (i--) {
                  if (imageData[((gy * g + y) * ngx * g +
                                 (gx * g + x)) * 4 + i] !== bgPixel[i]) {
                    grid[gx][gy] = false;
                    break singleGridLoop;
                  }
                }
              }
            }
            if (grid[gx][gy] !== false) {
              grid[gx][gy] = true;
            }
          }
        }

        imageData = bctx = bgPixel = undefined;
      }

      // fill the infoGrid with empty state if we need it
      if (settings.hover || settings.click) {

        interactive = true;

        /* fill the grid with empty state */
        gx = ngx + 1;
        while (gx--) {
          infoGrid[gx] = [];
        }

        if (settings.hover) {
          canvas.addEventListener('mousemove', wordcloudhover);
        }

        if (settings.click) {
          canvas.addEventListener('click', wordcloudclick);
          canvas.addEventListener('touchstart', wordcloudclick);
          canvas.addEventListener('touchend', function (e) {
            e.preventDefault();
          });
          canvas.style.webkitTapHighlightColor = 'rgba(0, 0, 0, 0)';
        }

        canvas.addEventListener('wordcloudstart', function stopInteraction() {
          canvas.removeEventListener('wordcloudstart', stopInteraction);

          canvas.removeEventListener('mousemove', wordcloudhover);
          canvas.removeEventListener('click', wordcloudclick);
          hovered = undefined;
        });
      }

      i = 0;
      var loopingFunction, stoppingFunction;
      if (settings.wait !== 0) {
        loopingFunction = window.setTimeout;
        stoppingFunction = window.clearTimeout;
      } else {
        loopingFunction = window.setImmediate;
        stoppingFunction = window.clearImmediate;
      }

      var addEventListener = function addEventListener(type, listener) {
        elements.forEach(function(el) {
          el.addEventListener(type, listener);
        }, this);
      };

      var removeEventListener = function removeEventListener(type, listener) {
        elements.forEach(function(el) {
          el.removeEventListener(type, listener);
        }, this);
      };

      var anotherWordCloudStart = function anotherWordCloudStart() {
        removeEventListener('wordcloudstart', anotherWordCloudStart);
        stoppingFunction(timer);
      };

      addEventListener('wordcloudstart', anotherWordCloudStart);

      var timer = loopingFunction(function loop() {
        if (i >= settings.list.length) {
          stoppingFunction(timer);
          sendEvent('wordcloudstop', false);
          removeEventListener('wordcloudstart', anotherWordCloudStart);

          return;
        }
        escapeTime = (new Date()).getTime();
        var drawn = putWord(settings.list[i]);
        var canceled = !sendEvent('wordclouddrawn', true, {
          item: settings.list[i], drawn: drawn });
        if (exceedTime() || canceled) {
          stoppingFunction(timer);
          settings.abort();
          sendEvent('wordcloudabort', false);
          sendEvent('wordcloudstop', false);
          removeEventListener('wordcloudstart', anotherWordCloudStart);
          return;
        }
        i++;
        timer = loopingFunction(loop, settings.wait);
      }, settings.wait);
    };

    // All set, start the drawing
    start();
  };

  WordCloud.isSupported = isSupported;
  WordCloud.minFontSize = minFontSize;

  // Expose the library as an AMD module
  if (typeof define === 'function' && define.amd) {
    define('wordcloud', [], function() { return WordCloud; });
  } else if (typeof module !== 'undefined' && module.exports) {
    module.exports = WordCloud;
  } else {
    global.WordCloud = WordCloud;
  }

})(this); //jshint ignore:line
