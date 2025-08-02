let idlessUserID = 100000;
const idlessUsers = new Map();

export function createLink(page, parameters, hash="") {
	let params = [];
	const keys = ["f", "t", "p"];
	if (parameters instanceof Map || parameters instanceof Set) {
		keys.forEach((key) => {
			if (parameters.has(key)) params.push([key, parameters.get(key)]);
		})
	} else if (parameters instanceof Array) {
		keys.forEach((key) => {
			if (getFromArray(parameters, key)) params.push(getFromArray(parameters, key));
		})
	} else if (parameters instanceof Object) {
		keys.forEach((key) => {
			if (parameters.hasOwnProperty(key)) params.push([key, parameters[key]]);
		})
	}

	//flatten with filename-safe sanity check
	params = params.map((entry) => {
		return entry.join("=").replace(/^[^\w_=-]+$/g,"-");
	})
	return `${page}-${[params.join('_')]}.htm${hash}`;
}
function getFromArray(array, key) {
	return array.find((value) => {
		if (value[0] = key) return value;
	});
}
export function getIdlessUserId(name) {
	let userId;
	if (!idlessUsers.has(name)) {
		userId = idlessUserID++;
		idlessUsers.set(name, userId);
	} else {
		userId = idlessUsers.get(name);
	}
	return userId;
}
export function getIdlessUserCount() {
	return idlessUsers.size;
}