export type PluginFactory<T, C = unknown> = (config: C) => T | null;

export class PluginRegistry<T, C = unknown> {
  private readonly factories = new Map<string, PluginFactory<T, C>>();

  register(type: string, factory: PluginFactory<T, C>): void {
    this.factories.set(type, factory);
  }

  /** Throws if type is unknown or factory returns null (missing config). */
  create(type: string, config: C): T {
    const factory = this.factories.get(type);
    if (!factory) throw new Error(`unknown plugin type: "${type}"`);
    const instance = factory(config);
    if (!instance) throw new Error(`plugin "${type}" failed to initialize — check config`);
    return instance;
  }

  has(type: string): boolean { return this.factories.has(type); }
  types(): string[] { return [...this.factories.keys()]; }
}
