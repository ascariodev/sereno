<?php

use Illuminate\Support\Arr;

function translationKeys(string $directory): array
{
    $keys = [];

    foreach (glob("$directory/*.php") as $file) {
        foreach (array_keys(Arr::dot(require $file)) as $key) {
            $keys[] = basename($file, '.php').".$key";
        }
    }

    return $keys;
}

it('has every framework and app php key in Spanish', function () {
    $frameworkKeys = translationKeys(base_path('vendor/laravel/framework/src/Illuminate/Translation/lang/en'));
    expect($frameworkKeys)->not->toBeEmpty();

    $english = array_merge($frameworkKeys, translationKeys(lang_path('en')));
    $spanish = translationKeys(lang_path('es'));

    // Son placeholders de ejemplo del framework, no textos traducibles.
    $missing = array_diff($english, $spanish, ['validation.custom.attribute-name.rule-name', 'validation.attributes']);

    expect($missing)->toBeEmpty();
});

it('has every en.json key in es.json', function () {
    $english = json_decode(file_get_contents(lang_path('en.json')), true, flags: JSON_THROW_ON_ERROR);
    $spanish = json_decode(file_get_contents(lang_path('es.json')), true, flags: JSON_THROW_ON_ERROR);

    expect(array_diff(array_keys($english), array_keys($spanish)))->toBeEmpty();
    expect(array_filter($spanish, fn ($value) => trim((string) $value) === ''))->toBeEmpty();
});
