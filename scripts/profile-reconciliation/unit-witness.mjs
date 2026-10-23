import { writeFile } from 'node:fs/promises';

export default class UnitWitness {
  async onTestRunEnd(modules, unhandledErrors, reason) {
    const tests = modules.flatMap((module) =>
      [...module.children.allTests()].map((test) => {
        const names = [test.name];
        for (let parent = test.parent; parent.type !== 'module'; parent = parent.parent)
          names.unshift(parent.name);
        const diagnostic = test.diagnostic();
        return {
          file: module.relativeModuleId,
          fullName: names.join(' '),
          state: test.result().state,
          retryCount: diagnostic?.retryCount,
          repeatCount: diagnostic?.repeatCount,
          retry:
            typeof test.options.retry === 'object'
              ? test.options.retry.count
              : (test.options.retry ?? 0),
          repeats: test.options.repeats ?? 0,
          fails: test.options.fails ?? false,
          mode: test.options.mode,
        };
      }),
    );
    await writeFile(
      '/tmp/unit-witness.json',
      JSON.stringify({
        version: 1,
        reason,
        tests,
        unhandledErrors,
        moduleErrors: modules.flatMap((module) =>
          [module, ...module.children.allSuites()].flatMap((suite) => suite.errors()),
        ),
      }),
      { flag: 'wx' },
    );
  }
}
