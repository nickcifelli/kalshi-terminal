import { constants, createPrivateKey, sign as cryptoSign } from "node:crypto";

/**
 * Signs `message` per Kalshi's scheme: RSA-PSS, SHA-256, salt length ==
 * digest length (PSS.DIGEST_LENGTH in the Python `cryptography` docs maps to
 * RSA_PSS_SALTLEN_DIGEST in OpenSSL/Node).
 */
function signPssText(privateKeyPem: string, message: string): string {
  const key = createPrivateKey(privateKeyPem);
  const signature = cryptoSign("sha256", Buffer.from(message, "utf8"), {
    key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return signature.toString("base64");
}

export interface KalshiAuthHeaders {
  [header: string]: string;
  "KALSHI-ACCESS-KEY": string;
  "KALSHI-ACCESS-SIGNATURE": string;
  "KALSHI-ACCESS-TIMESTAMP": string;
}

/**
 * Builds the three auth headers Kalshi expects for both REST requests and
 * the WebSocket handshake. `method` + `path` (no query string) are signed
 * together with the current millisecond timestamp.
 */
export function buildAuthHeaders(
  privateKeyPem: string,
  apiKeyId: string,
  method: string,
  path: string,
): KalshiAuthHeaders {
  const timestamp = String(Date.now());
  const message = `${timestamp}${method}${path}`;
  const signature = signPssText(privateKeyPem, message);
  return {
    "KALSHI-ACCESS-KEY": apiKeyId,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
  };
}
