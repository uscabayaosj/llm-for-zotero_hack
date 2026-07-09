export class FreshStartupConversationSession {
  private pending = false;

  begin(): void {
    this.pending = true;
  }

  consume(): boolean {
    if (!this.pending) return false;
    this.pending = false;
    return true;
  }
}

export const freshStartupConversationSession =
  new FreshStartupConversationSession();
