from typing import Dict, List, TypedDict
from langchain_core.messages import HumanMessage
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
import pandas as pd
import csv
import os
import json
import ollama
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY not found in environment variables")


# TypedDict for Strong Typing in StateGraph
class FieldMappingState(TypedDict):
    field_maps: Dict[str, Dict[str, str]]
    analysis_complete: bool
    etl_complete: bool
    current_vendor: str
    vendor_headers: List[str]
    vendor_samples: List[str]
    target_headers: List[str]
    target_samples: List[str]
    transformed_data: str


# Function to Read CSV Schema (Headers & Sample)
def read_csv_schema(file_path: str):
    """Reads CSV headers and a sample row if available."""
    df = pd.read_csv(file_path)

    headers = df.columns.tolist()  # Extract headers
    sample_row = df.iloc[0].tolist() if not df.empty else [""] * len(headers)  # Handle missing sample rows

    return headers, sample_row, df

# Function to Analyze and Generate Field Mapping
def analyze_fields(state: FieldMappingState, llm) -> FieldMappingState:
    vendor_fields = state['vendor_headers']
    target_fields = state['target_headers']

    # Ensure target_definitions are converted to strings
    target_definitions = [str(value) for value in state['target_samples']]

    field_mappings = {}
    for vendor_field in vendor_fields:
        prompt = f"""Match the vendor field '{vendor_field}' with the most relevant target field.
        Target fields and descriptions:
        {json.dumps(dict(zip(target_fields, target_definitions)), indent=4)}
        Return a JSON mapping vendor field to target field."""

        messages = [HumanMessage(content=prompt)]
        response = llm.invoke(messages)

        try:
            mapping = json.loads(response.content)  # Parse response as JSON
            if isinstance(mapping, dict) and vendor_field in mapping:
                field_mappings[vendor_field] = mapping[vendor_field]
        except json.JSONDecodeError:
            print(f"Invalid JSON response for {vendor_field}: {response.content}")

    state['field_maps'][state['current_vendor']] = field_mappings

    # Save the mapping to CSV
    mapping_file = f"{state['current_vendor']}_mappings.csv"
    pd.DataFrame(field_mappings.items(), columns=['vendor_field', 'target_field']).to_csv(mapping_file, index=False)

    print(f"Mapping template saved: {mapping_file}")
    state['analysis_complete'] = True
    return state


# Function to Perform ETL Using Stored Mapping Template
def perform_etl(state: FieldMappingState) -> FieldMappingState:
    vendor_file = "vendor.csv"
    mapping_file = f"{state['current_vendor']}_mappings.csv"
    output_file = f"{state['current_vendor']}_transformed.csv"

    if not os.path.exists(vendor_file):
        raise FileNotFoundError(f"Vendor data file '{vendor_file}' not found. Check working directory.")

    if not os.path.exists(mapping_file):
        raise FileNotFoundError(f"Field mapping file '{mapping_file}' not found. Run analysis first.")

    vendor_df = pd.read_csv(vendor_file)
    mapping_df = pd.read_csv(mapping_file)

    field_mapping = dict(zip(mapping_df['vendor_field'], mapping_df['target_field']))
    transformed_df = vendor_df.rename(columns=field_mapping)

    transformed_df.to_csv(output_file, index=False)
    print(f"ETL completed: Transformed data saved to {output_file}")

    state['etl_complete'] = True
    state['transformed_data'] = output_file
    return state


# Main Function to Execute Workflow
def generate_mapping_template(vendor_file: str, target_file: str, vendor_name: str):
    llm = ChatOpenAI(model="gpt-3.5-turbo", api_key=OPENAI_API_KEY)

    # Create Workflow
    workflow = StateGraph(FieldMappingState)

    # Define Nodes
    workflow.add_node("analyze_fields", lambda x: analyze_fields(x, llm))
    workflow.add_node("perform_etl", perform_etl)

    # Define Edges
    workflow.add_edge("analyze_fields", "perform_etl")
    workflow.add_edge("perform_etl", END)

    # Set Entry Point
    workflow.set_entry_point("analyze_fields")

    # Compile Workflow
    chain = workflow.compile()

    # Read Schemas
    vendor_headers, vendor_samples, _ = read_csv_schema(vendor_file)
    target_headers, target_samples, _ = read_csv_schema(target_file)

    # Normalize Headers
    vendor_headers = [h.strip().lower() for h in vendor_headers]

    # Initialize State
    state = FieldMappingState(
        field_maps={},
        analysis_complete=False,
        etl_complete=False,
        current_vendor=vendor_name,
        vendor_headers=vendor_headers,
        vendor_samples=vendor_samples,
        target_headers=target_headers,
        target_samples=target_samples,
        transformed_data=""
    )

    # Execute Workflow
    final_state = chain.invoke(state)
    return final_state['transformed_data']


# Run Workflow
transformed_file = generate_mapping_template('column.csv', 'customers.csv', 'Vendor_A')
print(f"Final Transformed File: {transformed_file}")
