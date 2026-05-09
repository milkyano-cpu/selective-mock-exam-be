import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  addSseClient,
  removeSseClient,
  sendSseBroadcast,
  sendSseToUser,
} from "../../src/lib/sse-manager.js";

function mockReply(write = jest.fn()) {
  return {
    raw: { write },
  };
}

describe("sse-manager", () => {
  const userId = "user-1";

  beforeEach(() => {
    // Keep module-level client state isolated between tests.
    for (const reply of [
      mockReply(),
    ]) {
      removeSseClient(userId, reply as never);
    }
  });

  it("sends an SSE event payload to a registered user client", () => {
    const write = jest.fn();
    const reply = mockReply(write);

    addSseClient(userId, reply as never);
    sendSseToUser(userId, "notification", { id: "notif-1", unread: true });

    expect(write).toHaveBeenCalledWith(
      'event: notification\ndata: {"id":"notif-1","unread":true}\n\n'
    );

    removeSseClient(userId, reply as never);
  });

  it("does nothing when a user has no registered clients", () => {
    expect(() => {
      sendSseToUser("missing-user", "notification", { id: "notif-1" });
    }).not.toThrow();
  });

  it("removes a client and stops sending to it", () => {
    const write = jest.fn();
    const reply = mockReply(write);

    addSseClient(userId, reply as never);
    removeSseClient(userId, reply as never);
    sendSseToUser(userId, "notification", { id: "notif-1" });

    expect(write).not.toHaveBeenCalled();
  });

  it("broadcasts only to the requested users", () => {
    const firstWrite = jest.fn();
    const secondWrite = jest.fn();
    const skippedWrite = jest.fn();
    const firstReply = mockReply(firstWrite);
    const secondReply = mockReply(secondWrite);
    const skippedReply = mockReply(skippedWrite);

    addSseClient("user-1", firstReply as never);
    addSseClient("user-2", secondReply as never);
    addSseClient("user-3", skippedReply as never);

    sendSseBroadcast(["user-1", "user-2"], "refresh", { ok: true });

    expect(firstWrite).toHaveBeenCalledTimes(1);
    expect(secondWrite).toHaveBeenCalledTimes(1);
    expect(skippedWrite).not.toHaveBeenCalled();

    removeSseClient("user-1", firstReply as never);
    removeSseClient("user-2", secondReply as never);
    removeSseClient("user-3", skippedReply as never);
  });

  it("drops clients whose raw stream write fails", () => {
    const write = jest.fn(() => {
      throw new Error("socket closed");
    });
    const reply = mockReply(write);

    addSseClient(userId, reply as never);
    sendSseToUser(userId, "notification", { id: "notif-1" });
    sendSseToUser(userId, "notification", { id: "notif-2" });

    expect(write).toHaveBeenCalledTimes(1);
  });
});
