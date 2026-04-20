exports.up = function (knex) {
  return knex.schema.createTable('semantic_dictionary_build_job', (table) => {
    table.increments('id').primary();
    table
      .integer('project_id')
      .notNullable()
      .unique()
      .references('id')
      .inTable('project')
      .onDelete('CASCADE');
    table.string('status').notNullable();
    table.string('current_step_key');
    table.text('current_step_description');
    table.integer('total_tasks').notNullable().defaultTo(0);
    table.integer('total_batches').notNullable().defaultTo(0);
    table.integer('completed_batches').notNullable().defaultTo(0);
    table.timestamp('started_at');
    table.timestamp('finished_at');
    table.text('error_message');
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('semantic_dictionary_build_job');
};
