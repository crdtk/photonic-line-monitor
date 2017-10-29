// A synthetic log for demonstrations and screenshots. It holds no machine data.
// It writes the log and a matching part names file into one folder.

var fs = require('fs');
var path = require('path');
var SimulatedMachine = require('./SimulatedMachine');

var NAMES = ['Lens Left', 'Lens Right', 'Local Align Left', 'Local Align Right',
	'Substrate Align Left', 'Substrate Align Right', 'VCSEL Left', 'VCSEL Right'];
var FILES = NAMES.map(function(n, i) { return 'part-' + String(i + 1).padStart(2, '0') + '.VID'; });

var CALIBRATION = { inner_diameter: 0.07, outer_diameter: 0.1, camera_mag_x: 0.0047, camera_mag_y: 0.0047 };

// The scenario: a run of boundary failures on one part, a second run on another,
// no-mark failures on two parts, two long stops, photo retries on two parts,
// a drifting part, and area checks with gold values and verdicts throughout.
function scenario() {
	return {
		imageSets: FILES,
		readings: 12,
		base: 84,
		spread: 3,
		seed: 7,
		areas: true,
		failRuns: [
			{ image: 'part-06.VID', from: 4, to: 14 },
			{ image: 'part-07.VID', from: 2, to: 9 }
		],
		noMark: [
			{ image: 'part-02.VID', at: 5 },
			{ image: 'part-04.VID', at: 8 }
		],
		stops: [
			{ image: 'part-05.VID', at: 6, seconds: 420 },
			{ image: 'part-08.VID', at: 9, seconds: 300 }
		],
		retries: [
			{ image: 'part-03.VID', extra: 3 },
			{ image: 'part-01.VID', extra: 1 }
		],
		drift: { image: 'part-08.VID', from: 6, by: 6 },
		phases: true,
		reuse: [{ image: 'part-05.VID', count: 4 }]
	};
}

// The part names file: one row per file, with the first score of that file in the log.
function mappingCsv(log) {
	var first = {}, cur = '';
	log.split('\n').forEach(function(l) {
		var m = l.match(/Loading VisionData .*\\(.*)$/);
		if (m) cur = m[1];
		var s = l.match(/Score: ([0-9.]+)/);
		if (s && cur && !(cur in first)) first[cur] = parseFloat(s[1]);
	});
	var csv = 'line,score,filename,timestamp,measurement\n';
	FILES.forEach(function(f, i) {
		csv += i + ',' + (first[f] || 0).toFixed(1) + ',' + f + ',2026-11-24 10:00:00.000000,' + NAMES[i] + '\n';
	});
	return csv;
}

function write(dir) {
	var log = SimulatedMachine.generate(CALIBRATION, scenario());
	fs.writeFileSync(path.join(dir, 'demo.LOG'), log);
	fs.writeFileSync(path.join(dir, 'demo-part-names.csv'), mappingCsv(log));
	return { log: path.join(dir, 'demo.LOG'), names: path.join(dir, 'demo-part-names.csv') };
}

module.exports = { write: write, scenario: scenario };
