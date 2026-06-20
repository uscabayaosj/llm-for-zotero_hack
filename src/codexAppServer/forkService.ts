import {
  archiveCodexAppServerThread,
  forkCodexAppServerThread,
} from "./nativeClient";

export type CodexAppServerForkService = {
  forkThread: typeof forkCodexAppServerThread;
  archiveThread: typeof archiveCodexAppServerThread;
};

export const codexAppServerForkService: CodexAppServerForkService = {
  forkThread: forkCodexAppServerThread,
  archiveThread: archiveCodexAppServerThread,
};
