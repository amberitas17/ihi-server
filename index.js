require('dotenv').config();
const express = require('express');
const { AzureOpenAI } = require('openai');
const app = express();
const port = process.env.PORT || 5000;

const azureOpenAIKey = process.env.AZURE_OPENAI_KEY;
const azureOpenAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureOpenAIVersion = process.env.OPENAI_API_VERSION;

if (!azureOpenAIKey || !azureOpenAIEndpoint || !azureOpenAIVersion) {
  throw new Error(
    "Please set AZURE_OPENAI_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_DEPLOYMENT_NAME in your environment variables."
  );
}

const getClient = () => {
  const assistantsClient = new AzureOpenAI({
    endpoint: azureOpenAIEndpoint,
    apiVersion: azureOpenAIVersion,
    apiKey: azureOpenAIKey,
  });
  return assistantsClient;
};

const assistantsClient = getClient();

app.use(express.json());

app.post('/ask', async (req, res) => {
  const userMessage = req.body.message;
  if (!userMessage) {
    return res.status(400).json({ error: 'Message body parameter is required' });
  }

  const options = {
    model: "gpt-4o-mini-2",
    name: "Assistant129",
    instructions: "You are here to visualize and generate charts and graphs. You are also going to process Excel files that is used for summarization.",
    tools: [{ type: "code_interpreter" }],
    tool_resources: {"code_interpreter":{"file_ids":[]}},
    temperature: 1,
    top_p: 1
  };
  const role = "user";
  const message = userMessage;

  try {
    // Create an assistant
    const assistantResponse = await assistantsClient.beta.assistants.create(options);
    console.log(`Assistant created: ${JSON.stringify(assistantResponse)}`);

    // Create a thread
    const assistantThread = await assistantsClient.beta.threads.create({});
    console.log(`Thread created: ${JSON.stringify(assistantThread)}`);

    // Add a user question to the thread
    const threadResponse = await assistantsClient.beta.threads.messages.create(
      assistantThread.id,
      {
        role,
        content: message,
      }
    );
    console.log(`Message created: ${JSON.stringify(threadResponse)}`);

    // Run the thread
    const runResponse = await assistantsClient.beta.threads.runs.create(
      assistantThread.id,
      {
        assistant_id: assistantResponse.id,
      }
    );
    console.log(`Run started: ${JSON.stringify(runResponse)}`);

    // Polling until the run completes or fails
    let runStatus = runResponse.status;
    while (runStatus === 'queued' || runStatus === 'in_progress') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const runStatusResponse = await assistantsClient.beta.threads.runs.retrieve(
        assistantThread.id,
        runResponse.id
      );
      runStatus = runStatusResponse.status;
      console.log(`Current run status: ${runStatus}`);
    }

     // Get the messages in the thread once the run has completed
     if (runStatus === 'completed') {
        const messagesResponse = await assistantsClient.beta.threads.messages.list(
            assistantThread.id
          );
          console.log(`Messages in the thread: ${JSON.stringify(messagesResponse)}`);
          const messages = [];
          let firstResponseAdded = false;
          for await (const runMessageDatum of messagesResponse) {
            for (const item of runMessageDatum.content) {
                if (!firstResponseAdded){
                  if (item.type === "text") {
                    messages.push({ type: "text", content: item.text?.value});
                    console.log(`Message: ${item.text?.value}`);
                    firstResponseAdded = true;
                  } else if (item.type === "image_file") {
                    try {
                      const imageResponse = await fetch(`https://azure2234.openai.azure.com/openai/files/${item.image_file.file_id}/content?api-version=2024-05-01-preview`, {
                        headers: {
                          'api-key': process.env.AZURE_OPENAI_KEY
                        }
                      });
                      const arrayBuffer = await imageResponse.arrayBuffer();
                      const base64Image = Buffer.from(arrayBuffer).toString('base64');
                      const decodedResponse = Buffer.from(base64Image, 'base64').toString('utf-8');
                      
                      // Check if the response is an error message
                      if (decodedResponse.includes('"error"')) {
                        console.error(`Error retrieving image file: ${decodedResponse}`);
                      } else {
                        messages.push({ type: "image", content: base64Image });
                        firstResponseAdded = true;
                      }
                    } catch (error) {
                      console.error(`Error retrieving image file: ${error.message}`);
                    }
                }
                }
            }
          }
        res.json({ messages });
      } else {
        res.status(500).json({ error: 'Failed to fetch messages' });
      }
    } catch (error) {
      console.error(`Error running the assistant: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});