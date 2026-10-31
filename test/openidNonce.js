'use strict';

// A fresh OpenID response_nonce, as Steam mints one: its UTC timestamp, then a unique suffix.
let count = 0;
const freshNonce = (at = Date.now()) => `${new Date(at).toISOString().slice(0, 19)}Z${count++}`;

module.exports = { freshNonce };
