// fork() gives this child an IPC channel. If the gateway disappears even
// without its signal handler running, the web child must not be orphaned.
process.on("disconnect", () => {
  // The parent may have been killed, so its shutdown deadline is gone.
  // A hung HTTP request must not keep this child alive indefinitely.
  setTimeout(() => process.exit(1), 8000).unref();
  process.kill(process.pid, "SIGTERM");
});
