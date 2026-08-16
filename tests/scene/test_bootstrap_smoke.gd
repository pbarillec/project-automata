extends GutTest

const MAIN_SCENE_PATH := "res://scenes/app/main.tscn"
const APP_SCRIPT_PATH := "res://scripts/app/app.gd"

func test_main_scene_resource_exists_and_loads() -> void:
	assert_true(ResourceLoader.exists(MAIN_SCENE_PATH), "Main scene resource should exist.")

	var scene := load(MAIN_SCENE_PATH)
	assert_not_null(scene, "Main scene should load.")
	assert_true(scene is PackedScene, "Main scene should be a PackedScene.")


func test_main_scene_instantiates_bootstrap_root() -> void:
	var scene := load(MAIN_SCENE_PATH) as PackedScene
	assert_not_null(scene, "Main scene should load before instantiation.")

	var instance := scene.instantiate()
	add_child_autofree(instance)

	assert_eq(instance.name, "App")
	assert_true(instance is Node, "Bootstrap root should be a Node.")
	assert_eq(instance.get_script().resource_path, APP_SCRIPT_PATH)
