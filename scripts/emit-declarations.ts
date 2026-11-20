import ts from "typescript";
// Declaration emission only. Type validation is performed by Bun's native
// checker (`bun run typecheck`), not by the TypeScript checker.
const config = ts.readConfigFile("tsconfig.json", ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram(parsed.fileNames, parsed.options);
const emitted = program.emit(undefined, undefined, undefined, true);
if (emitted.emitSkipped || emitted.diagnostics.length) {
  for (const diagnostic of emitted.diagnostics)
    console.error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  process.exit(1);
}
