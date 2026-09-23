/** Negotiated WebSocket compression for large snapshots only (#174).
 * Independent streams bound retained compressor state; ordinary tick/control
 * messages explicitly opt out when sent. Clients may decline the extension. */
export const SNAPSHOT_COMPRESSION = {
  serverNoContextTakeover: true,
  clientNoContextTakeover: true,
  threshold: 1024,
};
