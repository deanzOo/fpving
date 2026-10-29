import { parentPort, workerData } from "node:worker_threads";
import { startWorker } from "./worker-logic.js";

if (parentPort !== null) {
  void startWorker(parentPort, workerData);
}
