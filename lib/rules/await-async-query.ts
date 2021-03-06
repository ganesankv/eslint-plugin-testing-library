import { ESLintUtils, TSESTree } from '@typescript-eslint/experimental-utils';
import { getDocsUrl, LIBRARY_MODULES } from '../utils';
import {
  isCallExpression,
  isIdentifier,
  isMemberExpression,
  isAwaited,
  isPromiseResolved,
  getVariableReferences,
} from '../node-utils';
import { ReportDescriptor } from '@typescript-eslint/experimental-utils/dist/ts-eslint';

export const RULE_NAME = 'await-async-query';
export type MessageIds = 'awaitAsyncQuery';
type Options = [];

const ASYNC_QUERIES_REGEXP = /^find(All)?By(LabelText|PlaceholderText|Text|AltText|Title|DisplayValue|Role|TestId)$/;

function hasClosestExpectResolvesRejects(node: TSESTree.Node): boolean {
  if (!node.parent) {
    return false;
  }

  if (
    isCallExpression(node) &&
    isIdentifier(node.callee) &&
    isMemberExpression(node.parent) &&
    node.callee.name === 'expect'
  ) {
    const expectMatcher = node.parent.property;
    return (
      isIdentifier(expectMatcher) &&
      (expectMatcher.name === 'resolves' || expectMatcher.name === 'rejects')
    );
  } else {
    return hasClosestExpectResolvesRejects(node.parent);
  }
}

export default ESLintUtils.RuleCreator(getDocsUrl)<Options, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce async queries to have proper `await`',
      category: 'Best Practices',
      recommended: 'warn',
    },
    messages: {
      awaitAsyncQuery: '`{{ name }}` must have `await` operator',
    },
    fixable: null,
    schema: [],
  },
  defaultOptions: [],

  create(context) {
    const testingLibraryQueryUsage: {
      node: TSESTree.Identifier | TSESTree.MemberExpression;
      queryName: string;
    }[] = [];

    const isQueryUsage = (
      node: TSESTree.Identifier | TSESTree.MemberExpression
    ) =>
      !isAwaited(node.parent.parent) &&
      !isPromiseResolved(node) &&
      !hasClosestExpectResolvesRejects(node);

    let hasImportedFromTestingLibraryModule = false;

    function report(params: ReportDescriptor<'awaitAsyncQuery'>) {
      if (hasImportedFromTestingLibraryModule) {
        context.report(params);
      }
    }

    return {
      'ImportDeclaration > ImportSpecifier,ImportNamespaceSpecifier'(
        node: TSESTree.Node
      ) {
        const importDeclaration = node.parent as TSESTree.ImportDeclaration;
        const module = importDeclaration.source.value.toString();

        if (LIBRARY_MODULES.includes(module)) {
          hasImportedFromTestingLibraryModule = true;
        }
      },
      [`CallExpression > Identifier[name=${ASYNC_QUERIES_REGEXP}]`](
        node: TSESTree.Identifier
      ) {
        if (isQueryUsage(node)) {
          testingLibraryQueryUsage.push({ node, queryName: node.name });
        }
      },
      [`MemberExpression > Identifier[name=${ASYNC_QUERIES_REGEXP}]`](
        node: TSESTree.Identifier
      ) {
        // Perform checks in parent MemberExpression instead of current identifier
        const parent = node.parent as TSESTree.MemberExpression;
        if (isQueryUsage(parent)) {
          testingLibraryQueryUsage.push({ node: parent, queryName: node.name });
        }
      },
      'Program:exit'() {
        testingLibraryQueryUsage.forEach(({ node, queryName }) => {
          const references = getVariableReferences(context, node.parent.parent);

          if (references && references.length === 0) {
            report({
              node,
              messageId: 'awaitAsyncQuery',
              data: {
                name: queryName,
              },
            });
          } else {
            for (const reference of references) {
              const referenceNode = reference.identifier;
              if (
                !isAwaited(referenceNode.parent) &&
                !isPromiseResolved(referenceNode)
              ) {
                report({
                  node,
                  messageId: 'awaitAsyncQuery',
                  data: {
                    name: queryName,
                  },
                });

                break;
              }
            }
          }
        });
      },
    };
  },
});
