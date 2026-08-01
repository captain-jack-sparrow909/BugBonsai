globalThis.describe = (_name, callback) => callback();
globalThis.it = (_name, callback) => callback();
globalThis.test = globalThis.it;
globalThis.test.each = () => globalThis.test;

require("./sample.test.js");
