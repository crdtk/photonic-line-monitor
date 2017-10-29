// Reads the calibration values the vision log writes, and checks them
// against the calibration file kept beside the code. A mismatch means the
// machine or its settings changed, so the scores need a new reference.

var fs = require('fs');

var CALIBRATION_LINE = /Inner Diameter :([\d.]+),Outer Diameter:([\d.]+),\tCamera Mag X :([\d.]+),Camera Mag Y:([\d.]+)/;

function readCalibrationFile(path) {
	return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function readLogCalibrations(logText) {
	return logText
		.split('\n')
		.map(function(line) { return line.match(CALIBRATION_LINE); })
		.filter(function(m) { return m !== null; })
		.map(function(m) {
			return {
				inner_diameter: parseFloat(m[1]),
				outer_diameter: parseFloat(m[2]),
				camera_mag_x: parseFloat(m[3]),
				camera_mag_y: parseFloat(m[4])
			};
		});
}

// Returns the list of fields that differ between the file and every log line.
function mismatches(expected, logValues) {
	var fields = ['inner_diameter', 'outer_diameter', 'camera_mag_x', 'camera_mag_y'];
	var bad = [];
	logValues.forEach(function(v, i) {
		fields.forEach(function(f) {
			if (Math.abs(v[f] - expected[f]) > 1e-9) {
				bad.push({ line: i, field: f, expected: expected[f], found: v[f] });
			}
		});
	});
	return bad;
}

module.exports = { readCalibrationFile: readCalibrationFile, readLogCalibrations: readLogCalibrations, mismatches: mismatches };
