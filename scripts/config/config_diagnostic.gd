class_name ConfigDiagnostic
extends RefCounted

enum Severity {
	ERROR,
	WARNING
}

var severity: int
var stage: String
var source_path: String
var message: String


func _init(
		p_severity: Severity = Severity.ERROR,
		p_stage: String = "",
		p_source_path: String = "",
		p_message: String = ""
) -> void:
	severity = p_severity
	stage = p_stage
	source_path = p_source_path
	message = p_message


func is_error() -> bool:
	return severity == Severity.ERROR


func to_line() -> String:
	var severity_text := "ERROR" if severity == Severity.ERROR else "WARNING"
	return "%s [%s] %s: %s" % [severity_text, stage, source_path, message]
