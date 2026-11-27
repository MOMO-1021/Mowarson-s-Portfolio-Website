// ES module wrapper for the CommonJS payments implementation
import pkg from "./payments.js";

export const beginWebhookEvent = pkg.beginWebhookEvent;
export const completeWebhookEvent = pkg.completeWebhookEvent;
export const failWebhookEvent = pkg.failWebhookEvent;
export const recordPayment = pkg.recordPayment;
export const upsertOrder = pkg.upsertOrder;
