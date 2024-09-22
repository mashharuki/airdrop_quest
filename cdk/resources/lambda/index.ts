import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { Document } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  RunnableLambda,
  RunnableMap,
  RunnablePassthrough,
} from "@langchain/core/runnables";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getS3Object } from "./helper/s3";

// 環境変数を取得する。
const {OPENAI_API_KEY} = process.env;

/**
 * ハンドラー
 * @param event
 * @returns
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  
  console.log(`
    ================================ [START] ================================
  `);

  // S3バケット名を指定
  const bucketName = 'solana-radar-hackathon2024'; 
  // ファイル名を指定
  const objectKey = 'MagicBlock.md'; 

  const content = await getS3Object(bucketName, objectKey);
  // ベクトルデータストア
  const vectorStore = await HNSWLib.fromDocuments(
    [new Document({pageContent: content})],
    new OpenAIEmbeddings()
  );

  const retriever = vectorStore.asRetriever(1);
  // テンプレートプロンプト
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "ai",
      `Please create simple question based on only the following context:
        
      {context}`,
    ],
    ["human", "{question}"],
  ]);

  // モデルを指定
  const model = new ChatOpenAI({
    apiKey: OPENAI_API_KEY!,
  });
  const outputParser = new StringOutputParser();

  const setupAndRetrieval = RunnableMap.from({
    context: new RunnableLambda({
      func: (input: string) =>
        retriever.invoke(input).then((response) => response[0].pageContent),
    }).withConfig({runName: "contextRetriever"}),
    question: new RunnablePassthrough(),
  });

  let response;

  try {
    // プロンプトチェーンを作成
    const chain = setupAndRetrieval.pipe(prompt).pipe(model).pipe(outputParser);
    // プロンプトを実行
    const aiResponse = await chain.invoke(`
        MagicBookについて簡単なクイズを英語で作成してください。
        
        その際、回答は4択して正しい答えが1つだけになるようにしてください。
        問題と回答は1ペアだけ作成してください。
        問題文に答えが含まれないように注意してください。

        問題と回答は次の例に従ってJSON形式で出力してください。
        なお、correct_answerの値は必ずしも Aである必要はありません。

        よろしくお願いします。

        例：)

          {
            "question": "some question",
            "answers": {
              "A": "answer A",
              "B": "answer B",
              "C": "answer C",
              "D": "answer D"
            },
            "correct_answer": "answer A"
          }
    `);
    console.log("aiResponse:::", aiResponse);

    response = {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-API-KEY",
      },
      body: JSON.stringify({
        content: aiResponse,
      }),
    };
  } catch (e: any) {
    console.error("error: ", e);

    response = {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-API-KEY",
      },
      body: JSON.stringify({
        message: "send meta tx failed.",
      }),
    };
  } finally {
    console.log(`
      ================================ [END] ================================
    `);
  }

  return response;
}