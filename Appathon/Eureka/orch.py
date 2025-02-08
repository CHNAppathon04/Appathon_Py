from typing import Dict, List, TypedDict
from langchain_core.messages import HumanMessage
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
import pandas as pd
import csv
import os
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY not found in environment variables")

# TypedDict for Strong Typing in StateGraph
class FieldMappingState(TypedDict):
    field_maps: Dict[str, str]
    analysis_complete: bool
    current_vendor: str
    vendor_fields: List[str]  # Only field names for the vendor
    target_descriptions: Dict[str, str]  # Field names + descriptions for the customer

# Function to Read CSV Schema
def read_vendor_schema(file_path: str):
    """Reads only field names from the vendor file."""
    df = pd.read_csv(file_path, encoding="iso-8859-1")
    return df['Field Name'].tolist()

def read_customer_schema(file_path: str):
    """Reads both field names and descriptions from the customer file."""
    df = pd.read_csv(file_path, encoding="iso-8859-1")
    return dict(zip(df['Field Name'], df['Business Definition']))

# Function to Analyze and Generate Field Mapping Based on Descriptions
def analyze_fields(state: FieldMappingState, llm) -> FieldMappingState:
    prompt = f"""Match vendor fields to customer fields based on meaning:
    Vendor fields: {state['vendor_fields']}
    Customer fields with descriptions: {state['target_descriptions']}

    Return a JSON object in this format:
    {{
        "vendor_field_1": "customer_field_1",
        "vendor_field_2": "customer_field_2"
    }}
    """

    messages = [HumanMessage(content=prompt)]
    response = llm.invoke(messages)

    try:
        mappings = json.loads(response.content)  # Parse response as JSON
        if not isinstance(mappings, dict):
            raise ValueError("Response is not a valid dictionary.")
    except json.JSONDecodeError:
        raise ValueError(f"Invalid JSON response from LLM: {response.content}")

    state['field_maps'] = mappings

    # Save the mapping to CSV
    mapping_file = f"{state['current_vendor']}_mappings.csv"
    pd.DataFrame(mappings.items(), columns=['Vendor Field', 'Customer Field']).to_csv(mapping_file, index=False)

    print(f"Mapping template saved: {mapping_file}")
    state['analysis_complete'] = True
    return state

# Main Function to Execute Mapping
def generate_mapping_template(vendor_file: str, customer_file: str, vendor_name: str):
    llm = ChatOpenAI(model="gpt-3.5-turbo", api_key=OPENAI_API_KEY)

    # Create Workflow
    workflow = StateGraph(FieldMappingState)
    workflow.add_node("analyze_fields", lambda x: analyze_fields(x, llm))
    workflow.set_entry_point("analyze_fields")
    workflow.add_edge("analyze_fields", END)
    chain = workflow.compile()

    # Read Schemas
    vendor_fields = read_vendor_schema(vendor_file)
    target_schema = read_customer_schema(customer_file)

    # Initialize State
    state = FieldMappingState(
        field_maps={},
        analysis_complete=False,
        current_vendor=vendor_name,
        vendor_fields=vendor_fields,
        target_descriptions=target_schema
    )

    # Execute Workflow
    final_state = chain.invoke(state)
    return f"{vendor_name}_mappings.csv"

# Run Workflow
mapping_file = generate_mapping_template('../csv/vendor_input_format.csv', '../csv/sample.csv', 'Vendor_A')
print(f"Final Mapping File: {mapping_file}")