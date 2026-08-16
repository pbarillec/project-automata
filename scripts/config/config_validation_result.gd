class_name ConfigValidationResult
extends RefCounted

const ConfigDiagnosticScript := preload("res://scripts/config/config_diagnostic.gd")

var diagnostics: Array = []
var repository: GameConfigRepository = null


func add_error(stage: String, source_path: String, message: String) -> void:
	diagnostics.append(ConfigDiagnosticScript.new(
		ConfigDiagnosticScript.Severity.ERROR,
		stage,
		source_path,
		message
	))


func add_warning(stage: String, source_path: String, message: String) -> void:
	diagnostics.append(ConfigDiagnosticScript.new(
		ConfigDiagnosticScript.Severity.WARNING,
		stage,
		source_path,
		message
	))


func has_errors() -> bool:
	for diagnostic in diagnostics:
		if diagnostic.is_error():
			return true
	return false


func error_count() -> int:
	var count := 0
	for diagnostic in diagnostics:
		if diagnostic.is_error():
			count += 1
	return count


func to_lines() -> Array[String]:
	var lines: Array[String] = []
	for diagnostic in diagnostics:
		lines.append(diagnostic.to_line())
	return lines


func to_text() -> String:
	return "\n".join(to_lines())


func has_error_containing(text: String) -> bool:
	for diagnostic in diagnostics:
		if diagnostic.is_error() and diagnostic.to_line().contains(text):
			return true
	return false
