import type ModuleInstance from './main.js'
import { variableDefinitions } from './state.js'

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions(variableDefinitions(self.inputNames()))
}
