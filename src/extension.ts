/*
 Copyright (c) 2021 Kai Wood <kwood@kwd.io>

 This software is released under the MIT License.
 https://opensource.org/licenses/MIT
*/

/*
 Copyright (c) 2021 Jeremy Wells <jeremy@kealabs.co.nz>

 This software is released under the MIT License.
 https://opensource.org/licenses/MIT
*/

"use strict";
import * as path from "path";
import * as vscode from "vscode";
import * as Parser from "web-tree-sitter";

const initParser = Parser.init();
let parser: Parser;

/**
 * Activate plugin commands
 */
export function activate(context: vscode.ExtensionContext) {
  initParser.then(() => {
    const enter = vscode.commands.registerCommand("endsitter.enter", async () => {
      await endsitterEnter(context);
    });
    const cmdEnter = vscode.commands.registerCommand("endsitter.cmdEnter", async () => {
      await vscode.commands.executeCommand("cursorEnd");
      await endsitterEnter(context, true);
    });
    // We have to check "acceptSuggestionOnEnter" is set to a value !== "off" if the suggest widget is currently visible,
    // otherwise the suggestion won't be triggered because of the overloaded enter key.
    const checkForAcceptSelectedSuggestion = vscode.commands.registerCommand("endsitter.checkForAcceptSelectedSuggestion", async () => {
      const config = vscode.workspace.getConfiguration();
      const suggestionOnEnter = config.get("editor.acceptSuggestionOnEnter");
      if (suggestionOnEnter !== "off") {
        await vscode.commands.executeCommand("acceptSelectedSuggestion");
      } else {
        await vscode.commands.executeCommand("endsitter.enter");
      }
    });
    context.subscriptions.push(enter);
    context.subscriptions.push(cmdEnter);
    context.subscriptions.push(checkForAcceptSelectedSuggestion);
  });
}

/**
 * The plugin itself
 */

function nodeAtIndex(t: Parser.Tree, index: number) {
  const cursor = t.walk();
  let node;

  while (true) {
    if (cursor.startIndex <= index && cursor.endIndex >= index) {
      node = cursor.currentNode();
      if (!cursor.gotoFirstChild()) break;
    } else {
      if (!cursor.gotoNextSibling()) break;
    }
  }

  return node;
}

async function loadParser(context: vscode.ExtensionContext) {
  const absolute = path.join(context.extensionPath, "parsers", "tree-sitter-ruby.wasm");
  const wasm = path.relative(process.cwd(), absolute);
  const lang = await Parser.Language.load(wasm);

  const parser = new Parser();
  parser.setLanguage(lang);
  return parser;
}

async function endsitterEnter(context: vscode.ExtensionContext, calledWithModifier = false) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (!parser) {
    parser = await loadParser(context);
  }

  const lineNumber: number = editor.selection.active.line;
  const lineText: string = editor.document.lineAt(lineNumber).text;
  const lineLength: number = lineText.length;
  const index = editor.document.offsetAt(editor.selection.active);

  const textLines = editor.document.getText().split("\n");
  const column = editor.selection.active.character;
  textLines[lineNumber] = textLines[lineNumber].slice(0, column) + "\n" + textLines[lineNumber].slice(column);
  const text = textLines.join("\n");

  try {
    const t = parser.parse(text);
    if (t.rootNode.hasError()) {
      const node = nodeAtIndex(t, index);
      if (!node) return linebreak(editor);

      const newText = text.slice(0, node.endIndex) + "\nend\n" + text.slice(node.endIndex + 1);

      t.edit({
        startIndex: node.startIndex,
        oldEndIndex: node.endIndex,
        newEndIndex: node.endIndex + 5,
        startPosition: node.startPosition,
        oldEndPosition: node.endPosition,
        newEndPosition: {
          row: node.endPosition.row + 1,
          column: 3,
        },
      });

      const t2 = parser.parse(newText, t);

      if (!t2.rootNode.hasError()) {
        return linebreakWithClosing(editor);
      }
    }
  } catch (e) {
    console.log(e);
    return await linebreak(editor);
  }

  await linebreak(editor);

  /**
   * Insert a line break, add the correct closing and correct cursor position
   */
  async function linebreakWithClosing(editor: vscode.TextEditor) {
    await editor.edit((textEditor) => {
      textEditor.insert(new vscode.Position(lineNumber, lineLength), `\n${indentationFor(lineText)}end`);
    });

    await vscode.commands.executeCommand("cursorUp");
    vscode.commands.executeCommand("editor.action.insertLineAfter");
  }

  /**
   * Insert a linebreak, no closing, correct cursor position
   */
  async function linebreak(editor: vscode.TextEditor) {
    // Insert \n
    await vscode.commands.executeCommand("lineBreakInsert");

    // Move to the right to set the cursor to the next line
    await vscode.commands.executeCommand("cursorRight");

    // Get current line
    let newLine = await editor.document.lineAt(editor.selection.active.line).text;

    // If it's blank, don't do anything
    if (newLine.length === 0) return;

    // On lines containing only whitespace, we need to move to the right
    // to have the cursor at the correct indentation level.
    // Otherwise, we set the cursor to the beginning of the first word.
    if (newLine.match(/^\s+$/)) {
      await vscode.commands.executeCommand("cursorEnd");
    } else {
      await vscode.commands.executeCommand("cursorWordEndRight");
      await vscode.commands.executeCommand("cursorHome");
    }
  }

  /**
   * Helper to get indentation level of the previous line
   */
  function indentationFor(lineText: string) {
    const trimmedLine: string = lineText.trim();
    if (trimmedLine.length === 0) return lineText;

    const whitespaceEndsAt: number = lineText.indexOf(trimmedLine);
    const indentation: string = lineText.substr(0, whitespaceEndsAt);

    return indentation;
  }
}
