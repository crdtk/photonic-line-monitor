// Groups the readings by assembly site and side, using the measurement names
// in filename-mappings.csv. "Substrate Align Left" becomes site "Substrate
// Align", side "Left". Image sets with no name are grouped as "unnamed".

var fs = require('fs');

function readMappings(csvPath) {
	var map = {};
	fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1).forEach(function(line) {
		var cols = line.split(',');
		var image = cols[2];
		var name = (cols[4] || '').trim();
		if (image && name) map[image] = name;
	});
	return map;
}

// "Substrate Align Left" -> { site: "Substrate Align", side: "Left" }
function splitName(name) {
	var m = name.match(/^(.*)\s+(Left|Right)$/);
	return m ? { site: m[1], side: m[2] } : { site: name, side: '' };
}

function summariseBySite(readings, mappings) {
	var groups = {};
	var failed = {};
	readings.forEach(function(r) {
		var name = mappings[r.image];
		var where = name ? splitName(name) : { site: 'unnamed', side: '' };
		var key = where.site + '|' + where.side;
		if (r.failed) {
			failed[key] = (failed[key] || 0) + 1;
			groups[key] = groups[key] || [];
			return;
		}
		(groups[key] = groups[key] || []).push(r.score);
	});
	var keys = Object.keys(Object.assign({}, groups, failed)).sort();
	return keys.map(function(key) {
		var parts = key.split('|');
		var xs = groups[key] || [];
		var n = xs.length;
		var mean = n ? xs.reduce(function(a, b) { return a + b; }, 0) / n : null;
		var sd = n ? Math.sqrt(xs.reduce(function(a, x) { return a + (x - mean) * (x - mean); }, 0) / n) : null;
		var mx = (n - 1) / 2;
		var num = xs.reduce(function(a, x, i) { return a + (i - mx) * (x - mean); }, 0);
		var den = xs.reduce(function(a, x, i) { return a + (i - mx) * (i - mx); }, 0);
		return {
			site: parts[0],
			side: parts[1],
			valid: n,
			failed: failed[key] || 0,
			mean: mean,
			sd: sd,
			min: n ? Math.min.apply(null, xs) : null,
			max: n ? Math.max.apply(null, xs) : null,
			trend: n >= 2 ? num / den : null
		};
	});
}

module.exports = { readMappings: readMappings, splitName: splitName, summariseBySite: summariseBySite };
