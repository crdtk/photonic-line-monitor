// Writes a vision log in the same format as the real machine, so the charts
// can be shown without the machine. The random scores come from a seeded
// generator, so the same seed always gives the same log. With no extra options
// the log has scores only. The options below add the events the real machine
// writes, so the charts show failures, stops, area checks and drift.

function seeded(seed) {
	var state = seed >>> 0;
	return function() {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

// options:
//   imageSets, readings, base, spread, seed   (as before)
//   failRuns: [{ image, from, to }]   readings from..to-1 of that set fail the boundary trace
//   noMark:   [{ image, at }]         reading at of that set finds no mark (centre 0.0, 0.0)
//   stops:    [{ before, seconds }]   a gap before that image set is loaded
//             [{ image, at, seconds }] a gap before reading at of that set, so one set shows the stop
//   areas:    true                    one area check per reading, with a gold value and a verdict
//   drift:    { image, from, by }     scores of that set fall by 'by' from reading 'from' on
//   retries:  [{ image, extra }]      that set takes 'extra' more photos before its first reading
//   reuse:    [{ image, count }]     that set reads its file again without a new load, count times
//   phases:   true                    each score and area check also writes its step-done line
function generate(calibration, options) {
	var random = seeded(options.seed || 1);
	var lines = [];
	var clock = 0;
	var failRuns = options.failRuns || [];
	var noMark = options.noMark || [];
	var stops = options.stops || [];
	var retries = options.retries || [];
	var drift = options.drift || null;
	var reuse = options.reuse || [];
	function stamp() {
		var ms = clock;
		clock += 1500;
		var s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000) % 60, h = 16 + Math.floor(ms / 3600000);
		var pad = function(n, w) { return ('0' + n).slice(-w); };
		return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + ':' + pad(ms % 1000, 3);
	}
	function inRange(list, image, k) {
		return list.some(function(x) { return x.image === image && k >= x.from && k < x.to; });
	}
	options.imageSets.forEach(function(image, setIndex) {
		stops.forEach(function(s) { if (s.before === image) clock += s.seconds * 1000; });
		lines.push(stamp() + ' Loading VisionData from file C:\\Users\\demo\\VIDEO\\' + image);
		lines.push(stamp() + ' Inner Diameter :' + calibration.inner_diameter.toFixed(4) + ',Outer Diameter:' +
			calibration.outer_diameter.toFixed(4) + ',\tCamera Mag X :' + calibration.camera_mag_x.toFixed(4) +
			',Camera Mag Y:' + calibration.camera_mag_y.toFixed(4));
		retries.forEach(function(r) {
			if (r.image !== image) return;
			for (var e = 0; e < r.extra; e++) {
				lines.push(stamp() + ' SNAP ON (Camera 1)');
				lines.push(stamp() + ' SNAP DONE - Period: ' + (60 + random() * 6).toFixed(2));
			}
		});
		for (var r = 0; r < reuse.length; r++) {
			if (reuse[r].image !== image) continue;
			for (var u = 0; u < reuse[r].count; u++) lines.push(stamp() + ' Last File is same as current file. Using the same vision tool parameters');
		}
		for (var i = 0; i < options.readings; i++) {
			stops.forEach(function(s) { if (s.image === image && s.at === i) clock += s.seconds * 1000; });
			var cam = 1 + (i % 3);
			if (options.phases) {
				lines.push(stamp() + ' SNAP ON (Camera ' + cam + ')');
				lines.push(stamp() + ' SNAP DONE - Period: ' + (60 + random() * 6).toFixed(2));
			}
			var score = options.base + (random() - 0.5) * 2 * options.spread;
			if (drift && drift.image === image && i >= drift.from) score -= drift.by;
			if (inRange(failRuns, image, i)) {
				lines.push(stamp() + ' Map: 0, Camera: ' + cam + ', Center: (-1.000, -1.000), Angle: 0.00, Perimeter: 0, Area: 0, Pass: 0');
			} else if (noMark.some(function(x) { return x.image === image && x.at === i; })) {
				lines.push(stamp() + ' Map: 0, Camera: ' + cam + ', Center: (0.0, 0.0), Angle: 0.00, Score: 0.0, Pass: 0');
			} else {
				lines.push(stamp() + ' Map: 0, Camera: ' + cam + ', Center: (502.0, 377.0), Angle: 0.00, Score: ' +
					score.toFixed(1) + ', Pass: 1');
				if (options.phases) lines.push(stamp() + ' MAT DONE - Period: ' + (55 + random() * 15).toFixed(2));
			}
			if (options.areas) {
				// Each area check: a boundary line with the gold value and the machine verdict, then the area result.
				var gold = 8500 + setIndex * 150;
				var spike = random() < 0.05;
				var area = spike ? Math.round(gold * 0.35) : Math.round(gold + (random() - 0.5) * 8);
				var good = !spike && Math.abs(area - gold) <= 5;
				lines.push(stamp() + ' BT: Area(0, 0): ' + area + (good ? ' is good.' : ' is out of range.') +
					' Gold-Area: ' + gold + ', Tol: 5');
				if (options.phases) lines.push(stamp() + ' TRC DONE - Period: ' + (40 + random() * 10).toFixed(2));
				lines.push(stamp() + ' Map: 0, Camera: ' + cam + ', Center: (502.379, 377.711), Angle: 0.00, Perimeter: 306, Area: ' +
					area + ', Pass: ' + (good ? 1 : 0));
			}
		}
	});
	return lines.join('\n') + '\n';
}

module.exports = { generate: generate };
