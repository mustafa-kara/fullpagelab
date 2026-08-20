export interface CommandPlatform {
  addListener(listener: (command: string) => void): void;
}

export function createCommandController({
  platform,
  onVisibleCapture,
  onError,
}: {
  platform: CommandPlatform;
  onVisibleCapture: () => void | Promise<void>;
  onError: (error: unknown) => void;
}) {
  return {
    register(): void {
      platform.addListener((command) => {
        if (command !== 'capture-visible') return;
        void Promise.resolve(onVisibleCapture()).catch(onError);
      });
    },
  };
}
