extends Node

const SMOKE_EXIT_ARG := "--automata-smoke-exit"

func _ready() -> void:
	print("Project Automata bootstrap scene loaded.")
	if OS.get_cmdline_user_args().has(SMOKE_EXIT_ARG):
		get_tree().quit()

