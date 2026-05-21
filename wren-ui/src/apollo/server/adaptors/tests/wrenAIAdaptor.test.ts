import axios from 'axios';
import { WrenAIAdaptor } from '../wrenAIAdaptor';
import {
  AskCandidateType,
  AskResultStatus,
  RecommendationQuestionsInput,
  RecommendationQuestionStatus,
  SQLDialect,
} from '@server/models/adaptor';
import { Manifest } from '../../mdl/type';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const sampleManifest: Manifest = {
  models: [
    {
      name: 'model1',
      columns: [
        {
          name: 'column1',
          type: 'string',
          isCalculated: false,
        },
      ],
    },
  ],
};

describe('WrenAIAdaptor', () => {
  const baseEndpoint = 'http://test-endpoint';
  let adaptor: WrenAIAdaptor;

  beforeEach(() => {
    adaptor = new WrenAIAdaptor({ wrenAIBaseEndpoint: baseEndpoint });
    jest.clearAllMocks();
  });

  describe('getAskResult', () => {
    it('maps snake_case sql_dialect from AI service to sqlDialect', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          status: 'finished',
          type: 'TEXT_TO_SQL',
          response: [
            {
              type: 'llm',
              sql: 'SELECT "city" FROM "dv_order_base"',
              sql_dialect: 'DIALECT',
            },
          ],
        },
      });

      const result = await adaptor.getAskResult('ask-1');

      expect(result.status).toBe(AskResultStatus.FINISHED);
      expect(result.response?.[0]).toEqual(
        expect.objectContaining({
          type: AskCandidateType.LLM,
          sqlDialect: SQLDialect.DIALECT,
        }),
      );
    });

    it('maps query decomposition summary without subquery SQL', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          status: 'planning',
          type: 'TEXT_TO_SQL',
          query_decomposition: {
            complexity: 'complex',
            subquery_count: 2,
            subqueries: [
              {
                cte_name: 'package_order_counts',
                objective: '按选装包统计订单数量',
                grain: '选装包',
              },
            ],
          },
        },
      });

      const result = await adaptor.getAskResult('ask-1');

      expect(result.status).toBe(AskResultStatus.PLANNING);
      expect(result.queryDecomposition).toEqual({
        complexity: 'complex',
        subqueryCount: 2,
        subqueries: [
          {
            cteName: 'package_order_counts',
            objective: '按选装包统计订单数量',
            grain: '选装包',
          },
        ],
      });
    });
  });

  describe('generateRecommendationQuestions', () => {
    const mockInput: RecommendationQuestionsInput = {
      manifest: sampleManifest,
      previousQuestions: ['What is sales by region?'],
      projectId: 'project-123',
      maxQuestions: 5,
      maxCategories: 3,
      configuration: {
        language: 'English',
      },
    };

    it('should successfully generate recommendation questions', async () => {
      const mockQueryId = 'query-123';
      mockedAxios.post.mockResolvedValueOnce({ data: { id: mockQueryId } });

      const result = await adaptor.generateRecommendationQuestions(mockInput);

      expect(result).toEqual({ queryId: mockQueryId });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/question-recommendations`,
        {
          mdl: JSON.stringify(mockInput.manifest),
          previous_questions: mockInput.previousQuestions,
          max_questions: mockInput.maxQuestions,
          max_categories: mockInput.maxCategories,
          configuration: mockInput.configuration,
        },
      );
    });

    it('should handle errors when generating recommendation questions', async () => {
      const errorMessage = 'Network error';
      mockedAxios.post.mockRejectedValueOnce(new Error(errorMessage));

      await expect(
        adaptor.generateRecommendationQuestions(mockInput),
      ).rejects.toThrow(errorMessage);
    });
  });

  describe('getRecommendationQuestionsResult', () => {
    const queryId = 'query-123';

    it('should successfully get recommendation questions result', async () => {
      const mockResponse = {
        status: 'FINISHED',
        response: {
          questions: [
            {
              question: 'What is the total revenue?',
              explanation: 'This shows overall business performance',
              category: 'Revenue',
            },
          ],
        },
      };

      mockedAxios.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await adaptor.getRecommendationQuestionsResult(queryId);

      expect(result).toEqual({
        status: RecommendationQuestionStatus.FINISHED,
        error: null,
        ...mockResponse,
      });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/question-recommendations/${queryId}`,
      );
    });

    it('should handle errors when getting recommendation questions result', async () => {
      const errorMessage = 'Network error';
      mockedAxios.get.mockRejectedValueOnce(new Error(errorMessage));

      await expect(
        adaptor.getRecommendationQuestionsResult(queryId),
      ).rejects.toThrow(errorMessage);
    });
  });
});
