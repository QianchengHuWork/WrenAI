import pytest

from src.pipelines.generation.sql_correction import post_process


class UnexpectedPostProcessor:
    async def run(self, *args, **kwargs):
        raise AssertionError("post processor should not be called")


@pytest.mark.asyncio
async def test_sql_correction_post_process_skips_engine_validation_in_none_mode():
    result = await post_process(
        generate_sql_correction={
            "replies": ['{"sql":"SELECT \\"city\\" FROM \\"dv_order_base\\""}']
        },
        post_processor=UnexpectedPostProcessor(),
        data_source="postgres",
        validation_mode="none",
    )

    assert result["valid_generation_result"]["sql"] == 'SELECT "city" FROM "dv_order_base"'
    assert result["invalid_generation_result"] == {}
