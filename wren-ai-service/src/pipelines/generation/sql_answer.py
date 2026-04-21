import asyncio
import logging
import sys
from typing import Any, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from haystack.components.builders.prompt_builder import PromptBuilder
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import LLMProvider
from src.pipelines.common import clean_up_new_lines
from src.utils import trace_cost
from src.web.v1.services import Configuration

logger = logging.getLogger("wren-ai-service")

sql_to_answer_system_prompt = """
### TASK

You are a data analyst who explains query results to non-technical users.
Answer based on the user's question, the SQL, and the returned data so the user can quickly understand the business meaning.

### INSTRUCTIONS

1. Read the user's question and understand the user's intention.
2. Read the sql and understand the data.
3. Make sure the answer is aimed at non-technical users, so do not mention technical terms such as SQL syntax, joins, CTEs, or column names unless absolutely necessary.
4. By default, organize the answer into four short sections in this order:
   - Conclusion
   - Change Magnitude
   - Possible Reasons
   - Data Gaps
5. In Conclusion, answer the user's question directly first.
6. In Change Magnitude, quantify the change whenever the data allows it. Prefer explicit numbers, such as percentage points, percentages, absolute deltas, ranking movement, or month-over-month change.
7. In Possible Reasons, only mention reasons that are directly supported by the returned data or are clearly framed as limited inference from the observed numbers. Do not invent business explanations that are not supported by the data.
8. In Data Gaps, explicitly call out missing comparison periods, missing dimensions, insufficient sample size, nulls, missing months, or any other limitation that prevents stronger analysis. If there is no obvious gap, say that the current result only supports a limited surface-level conclusion.
9. If the answer is in list format, only list top few examples, and tell users there are more results omitted.
10. Answer must be in the same language the user specified.
11. Do not include ```markdown or ``` in the answer.
12. If the user provides a custom instruction, follow it strictly while still keeping the answer grounded in the provided data.

### OUTPUT FORMAT

Please provide your response in proper Markdown string format.
"""

sql_to_answer_user_prompt_template = """
### Inputs ###
User's question: {{ query }}
SQL: {{ sql }}
Data: 
columns: {{ sql_data.columns }}
rows: {{ sql_data.data }}
Language: {{ language }}
Current Time: {{ current_time }}

Custom Instruction: {{ custom_instruction }}

Please think step by step and answer the user's question.
"""


## Start of Pipeline
@observe(capture_input=False)
def prompt(
    query: str,
    sql: str,
    sql_data: dict,
    language: str,
    current_time: str,
    custom_instruction: str,
    prompt_builder: PromptBuilder,
) -> dict:
    _prompt = prompt_builder.run(
        query=query,
        sql=sql,
        sql_data=sql_data,
        language=language,
        current_time=current_time,
        custom_instruction=custom_instruction,
    )
    return {"prompt": clean_up_new_lines(_prompt.get("prompt"))}


@observe(as_type="generation", capture_input=False)
@trace_cost
async def generate_answer(
    prompt: dict, generator: Any, query_id: str, generator_name: str
) -> dict:
    return await generator(
        prompt=prompt.get("prompt"), query_id=query_id
    ), generator_name


## End of Pipeline


class SQLAnswer(BasicPipeline):
    def __init__(
        self,
        llm_provider: LLMProvider,
        **kwargs,
    ):
        self._user_queues = {}
        self._components = {
            "prompt_builder": PromptBuilder(
                template=sql_to_answer_user_prompt_template
            ),
            "generator": llm_provider.get_generator(
                system_prompt=sql_to_answer_system_prompt,
                streaming_callback=self._streaming_callback,
            ),
            "generator_name": llm_provider.get_model(),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def _streaming_callback(self, chunk, query_id):
        if query_id not in self._user_queues:
            self._user_queues[
                query_id
            ] = asyncio.Queue()  # Create a new queue for the user if it doesn't exist
        # Put the chunk content into the user's queue
        asyncio.create_task(self._user_queues[query_id].put(chunk.content))
        if chunk.meta.get("finish_reason"):
            asyncio.create_task(self._user_queues[query_id].put("<DONE>"))

    async def get_streaming_results(self, query_id):
        async def _get_streaming_results(query_id):
            return await self._user_queues[query_id].get()

        if query_id not in self._user_queues:
            self._user_queues[
                query_id
            ] = asyncio.Queue()  # Ensure the user's queue exists
        while True:
            try:
                # Wait for an item from the user's queue
                self._streaming_results = await asyncio.wait_for(
                    _get_streaming_results(query_id), timeout=120
                )
                if (
                    self._streaming_results == "<DONE>"
                ):  # Check for end-of-stream signal
                    del self._user_queues[query_id]
                    break
                if self._streaming_results:  # Check if there are results to yield
                    yield self._streaming_results
                    self._streaming_results = ""  # Clear after yielding
            except TimeoutError:
                break

    @observe(name="SQL Answer Generation")
    async def run(
        self,
        query: str,
        sql: str,
        sql_data: dict,
        language: str,
        current_time: str = Configuration().show_current_time(),
        query_id: Optional[str] = None,
        custom_instruction: Optional[str] = None,
    ) -> dict:
        logger.info("Sql_Answer Generation pipeline is running...")
        return await self._pipe.execute(
            ["generate_answer"],
            inputs={
                "query": query,
                "sql": sql,
                "sql_data": sql_data,
                "language": language,
                "current_time": current_time,
                "query_id": query_id,
                "custom_instruction": custom_instruction or "",
                **self._components,
            },
        )
