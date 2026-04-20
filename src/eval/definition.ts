import {AgentQError} from '../core/errors';
import type {EvalCaseDefinition, EvalDefinition} from './types';

const EVAL_BRAND = Symbol.for('agentq.eval.definition');

export type DefinedEval = EvalDefinition & {[EVAL_BRAND]: true};

export function defineEval(definition: EvalDefinition): DefinedEval {
  validateEvalDefinition(definition);
  const branded = Object.assign({}, definition) as DefinedEval;
  Object.defineProperty(branded, EVAL_BRAND, {
    enumerable: false,
    value: true,
  });
  return Object.freeze(branded);
}

export function isDefinedEval(value: unknown): value is DefinedEval {
  return Boolean(value && typeof value === 'object' && EVAL_BRAND in value);
}

function validateEvalDefinition(definition: EvalDefinition): void {
  if (!definition || typeof definition !== 'object') {
    throw new AgentQError('Eval definition must be an object.');
  }
  if (typeof definition.name !== 'string' || definition.name.trim() === '') {
    throw new AgentQError('Eval definition must include a non-empty name.');
  }
  if (!Array.isArray(definition.cases)) {
    throw new AgentQError('Eval definition must include a cases array.');
  }

  for (const evalCase of definition.cases) {
    validateCase(evalCase);
  }
}

function validateCase(evalCase: EvalCaseDefinition): void {
  const caseData = evalCase as {
    graders?: unknown;
    id?: unknown;
    inputFile?: unknown;
    inputText?: unknown;
    inputs?: unknown;
    type?: string;
    agent?: unknown;
    command?: unknown;
    harness?: unknown;
    task?: unknown;
  };
  if (!evalCase || typeof evalCase !== 'object') {
    throw new AgentQError('Eval cases must be objects.');
  }
  if (typeof caseData.id !== 'string' || caseData.id.trim() === '') {
    throw new AgentQError('Eval cases must include a non-empty id.');
  }
  if (!Array.isArray(caseData.graders)) {
    throw new AgentQError(`Eval case "${caseData.id}" must include graders.`);
  }
  if (caseData.graders.length === 0) {
    throw new AgentQError(
      `Eval case "${caseData.id}" must include at least one grader.`,
    );
  }
  if (typeof caseData.type !== 'string') {
    throw new AgentQError(`Eval case "${caseData.id}" must include a type.`);
  }

  switch (caseData.type) {
    case 'command':
      validateCommandCase(caseData);
      return;
    case 'agent':
      validateAgentCase(caseData);
      return;
    case 'harness':
      validateHarnessCase(caseData);
      return;
    default:
      throw new AgentQError(
        `Eval case "${caseData.id}" has unknown type "${String(caseData.type)}".`,
      );
  }
}

function validateCommandCase(evalCase: {
  command?: unknown;
  id?: unknown;
}): void {
  if (!Array.isArray(evalCase.command) || evalCase.command.length === 0) {
    throw new AgentQError(
      `Eval case "${String(evalCase.id)}" must include a non-empty command array.`,
    );
  }
}

function validateAgentCase(evalCase: {
  agent?: unknown;
  id?: unknown;
  task?: unknown;
}): void {
  if (typeof evalCase.agent !== 'string' || evalCase.agent.trim() === '') {
    throw new AgentQError(
      `Eval case "${String(evalCase.id)}" must include an agent id.`,
    );
  }
  if (typeof evalCase.task !== 'string' || evalCase.task.trim() === '') {
    throw new AgentQError(
      `Eval case "${String(evalCase.id)}" must include a task.`,
    );
  }
}

function validateHarnessCase(evalCase: {
  harness?: unknown;
  id?: unknown;
  inputFile?: unknown;
  inputText?: unknown;
  inputs?: unknown;
}): void {
  if (typeof evalCase.harness !== 'string' || evalCase.harness.trim() === '') {
    throw new AgentQError(
      `Eval case "${String(evalCase.id)}" must include a harness name.`,
    );
  }
  if (
    evalCase.inputText === undefined &&
    evalCase.inputFile === undefined &&
    evalCase.inputs === undefined
  ) {
    throw new AgentQError(
      `Eval case "${String(evalCase.id)}" must include inputText, inputFile, or inputs.`,
    );
  }
}
