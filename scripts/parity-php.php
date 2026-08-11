<?php
declare(strict_types=1);

$fixtureIndex = array_search('--fixture', $argv, true);
$fixturePath = $fixtureIndex !== false && isset($argv[$fixtureIndex + 1])
    ? $argv[$fixtureIndex + 1]
    : __DIR__ . '/../tests/parity/fixtures/core.json';
$fixture = json_decode((string)file_get_contents($fixturePath), true, 512, JSON_THROW_ON_ERROR);
$cases = [];

foreach ($fixture['cases'] as $case) {
    $name = $case['name'];
    $input = $case['input'];
    if ($name === 'date-format') {
        $date = new DateTimeImmutable($input['value'], new DateTimeZone('UTC'));
        $cases[] = ['name' => $name, 'value' => $date->format('d.m.Y')];
    } elseif ($name === 'number-format') {
        $cases[] = ['name' => $name, 'value' => number_format((float)$input['value'], 2, ',', '.')];
    } elseif ($name === 'team-scope') {
        $visible = array_values(array_filter($input['ids'], static fn($id) => $id % 2 === 1));
        $cases[] = ['name' => $name, 'visibleIds' => $visible];
    } elseif ($name === 'csv-escaping') {
        $cases[] = ['name' => $name, 'quoted' => preg_match('/[;\n\r"]/', $input['value']) === 1];
    } else {
        $cases[] = ['name' => $name, 'value' => $input];
    }
}

echo json_encode(['version' => $fixture['version'], 'cases' => $cases], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
